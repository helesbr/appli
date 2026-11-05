require('dotenv').config();
const express = require('express');
const path = require('path');

const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
// Nettoie les erreurs de copier-coller courantes (espaces, retours à la ligne, guillemets, "MONGODB_URI=")
const MONGODB_URI = (process.env.MONGODB_URI || '')
  .replace(/\s+/g, '')
  .replace(/^["']+|["']+$/g, '')
  .replace(/^MONGODB_URI=/i, '')
  .replace(/^["']+|["']+$/g, '')
  .replace(/MONGODB_DBNAME=.*$/i, '');
const MONGODB_DBNAME = process.env.MONGODB_DBNAME || 'moggtrack';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// On ne renvoie jamais le _id Mongo au client : l'appli utilise son propre champ "id"
const NO_ID = { projection: { _id: 0 } };
const DAY_MS = 24 * 60 * 60 * 1000;

app.disable('x-powered-by');

// --- EN-TÊTES DE SÉCURITÉ (sans dépendance supplémentaire) ---
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Le service worker, la page et ses scripts doivent toujours être revalidés pour recevoir les mises à jour
    if (/(sw\.js|index\.html)$|[\\/]js[\\/][^\\/]+\.js$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// --- BASE DE DONNÉES ---
let db, sessionsCol, templatesCol, restTimersCol, devicesCol, loginAttemptsCol, appErrorsCol;

async function connectMongo() {
  if (!MONGODB_URI) throw new Error('Variable MONGODB_URI manquante ou vide');
  if (!/^mongodb(\+srv)?:\/\//.test(MONGODB_URI)) {
    throw new Error(`MONGODB_URI doit commencer par mongodb+srv:// (début actuel : "${MONGODB_URI.slice(0, 12)}…", ${MONGODB_URI.length} caractères)`);
  }
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(MONGODB_DBNAME);
  sessionsCol = db.collection('sessions');
  templatesCol = db.collection('templates');
  restTimersCol = db.collection('restTimers');
  devicesCol = db.collection('devices');
  loginAttemptsCol = db.collection('loginAttempts');
  appErrorsCol = db.collection('appErrors');
  await ensureIndexes();
  console.log('Connecté à MongoDB Atlas');
}

// Toutes les requêtes filtrent sur "id" ou sur "date" (plage de dates).
// Sans index, chacune parcourt toute la collection (COLLSCAN).
async function ensureIndexes() {
  const specs = [
    [sessionsCol, { id: 1 }, { unique: true, name: 'id_unique' }],
    [sessionsCol, { date: 1 }, { name: 'date_asc' }],
    [templatesCol, { id: 1 }, { unique: true, name: 'id_unique' }],
    [restTimersCol, { id: 1 }, { unique: true, name: 'id_unique' }],
    [devicesCol, { id: 1 }, { unique: true, name: 'id_unique' }],
    [loginAttemptsCol, { key: 1 }, { unique: true, name: 'key_unique' }],
    [appErrorsCol, { at: 1 }, { name: 'at_asc' }],
    // Mongo supprime seul ces documents une fois périmés
    [restTimersCol, { expireAt: 1 }, { expireAfterSeconds: 0, name: 'expire_at' }],
    [devicesCol, { expireAt: 1 }, { expireAfterSeconds: 0, name: 'expire_at' }],
    [loginAttemptsCol, { expireAt: 1 }, { expireAfterSeconds: 0, name: 'expire_at' }],
    [appErrorsCol, { expireAt: 1 }, { expireAfterSeconds: 0, name: 'expire_at' }]
  ];
  for (const [col, key, opts] of specs) {
    try {
      await col.createIndex(key, opts);
    } catch (e) {
      // Ex. : doublons existants sur "id" ; l'appli fonctionne quand même
      console.warn(`Index ${col.collectionName}.${opts.name} non créé :`, e.message);
    }
  }
}

// Connexion partagée ; en cas d'échec, on retentera à la requête suivante
let mongoReady = null;
function ensureMongo() {
  if (!mongoReady) {
    mongoReady = connectMongo().catch(e => {
      mongoReady = null;
      throw e;
    });
  }
  return mongoReady;
}

// Pas d'arrêt si la base est injoignable : la page reste servie, l'API renvoie
// l'erreur et la connexion est retentée à chaque requête (comme sur Vercel)
ensureMongo().catch(e => {
  console.error('Erreur MongoDB:', e.message);
  if (!MONGODB_URI) console.error('→ Ajoute MONGODB_URI (et APP_PASSWORD) dans le fichier .env');
});

// --- SUIVI DES ERREURS ---
// Gardées 30 jours et comptées par /api/health, que le contrôle GitHub surveille chaque heure
const ERROR_THROTTLE_MS = 60 * 1000;
const lastErrorAt = new Map();
function reportError(source, error) {
  const message = String((error && (error.body || error.message)) || error).slice(0, 300);
  console.error(`[${source}]`, message);
  const now = Date.now();
  if (now - (lastErrorAt.get(source) || 0) < ERROR_THROTTLE_MS) return;
  lastErrorAt.set(source, now);
  if (!appErrorsCol) return;
  appErrorsCol.insertOne({ source, message, at: new Date(now), expireAt: new Date(now + 30 * DAY_MS) })
    .catch(e => console.error('Erreur non enregistrée :', e.message));
}

// --- AUTHENTIFICATION (mot de passe unique défini dans la variable APP_PASSWORD) ---
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();
const DEVICE_TTL_MS = 180 * DAY_MS; // sans utilisation pendant 6 mois, l'appareil est déconnecté
const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_DELAY_MS = Number(process.env.LOGIN_DELAY_MS) || 800;
const NO_PASSWORD = { error: 'Mot de passe non configuré : ajoute la variable APP_PASSWORD', code: 'NO_PASSWORD' };

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
// Signé avec le mot de passe : le changer déconnecte tous les appareils
function signToken(payload) {
  return crypto.createHmac('sha256', 'moggtrack:' + APP_PASSWORD).update(payload).digest('base64url');
}
// Une connexion vaut pour la journée, qui change à 4 h à Paris :
// une séance tardive n'est jamais coupée par minuit.
const SESSION_DAY_START_MS = 4 * 60 * 60 * 1000;
const sessionDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
function sessionDay(now = Date.now()) {
  return sessionDayFormat.format(new Date(now - SESSION_DAY_START_MS));
}
function deviceToken(id) {
  const day = sessionDay();
  return `d.${id}.${day}.${signToken(`device:${id}:${day}`)}`;
}
// Se reconnecter réutilise la fiche de l'appareil : la liste ne grossit pas chaque jour
async function openDeviceSession(deviceId, name) {
  const now = new Date();
  const expireAt = new Date(now.getTime() + DEVICE_TTL_MS);
  const known = typeof deviceId === 'string' && UUID_RE.test(deviceId) && await devicesCol.findOne({ id: deviceId });
  if (known) {
    await devicesCol.updateOne({ id: deviceId }, { $set: { lastSeen: now, expireAt } });
    return deviceToken(deviceId);
  }
  const id = crypto.randomUUID();
  await devicesCol.insertOne({ id, name: cleanText(name, 60) || 'Appareil', createdAt: now, lastSeen: now, expireAt });
  return deviceToken(id);
}
// Renvoie l'appareil connecté, ou null si le jeton est invalide, d'un autre jour ou d'un appareil déconnecté
async function authenticate(token) {
  const parts = String(token || '').split('.');
  if (parts[0] !== 'd' || parts.length !== 4) return null;
  const [, id, day, sig] = parts;
  if (!UUID_RE.test(id) || day !== sessionDay() || !safeEqual(sig, signToken(`device:${id}:${day}`))) return null;
  return devicesCol.findOne({ id }, NO_ID);
}

function loginKey(req) {
  const ip = (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(ip).digest('hex');
}
async function loginBlockMinutes(key) {
  const attempts = await loginAttemptsCol.findOne({ key });
  if (!attempts || attempts.count < MAX_LOGIN_FAILURES) return 0;
  const left = new Date(attempts.expireAt).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : 0;
}
async function recordLoginFailure(key) {
  await loginAttemptsCol.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(Date.now() + LOGIN_BLOCK_MS) } },
    { upsert: true }
  );
}

app.post('/api/login', async (req, res, next) => {
  try {
    if (!APP_PASSWORD) return res.status(503).json(NO_PASSWORD);
    await ensureMongo();
    const key = loginKey(req);
    const minutes = await loginBlockMinutes(key);
    if (minutes) {
      return res.status(429).json({ error: `Trop d'essais : réessaie dans ${minutes} min`, code: 'TOO_MANY_ATTEMPTS' });
    }
    if (!safeEqual((req.body && req.body.password) || '', APP_PASSWORD)) {
      await recordLoginFailure(key);
      await new Promise(r => setTimeout(r, LOGIN_DELAY_MS)); // ralentit les essais en série
      return res.status(401).json({ error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' });
    }
    await loginAttemptsCol.deleteOne({ key });
    res.json({ token: await openDeviceSession(req.body.deviceId, req.body.deviceName) });
  } catch (e) {
    next(e);
  }
});

// --- NOTIFICATIONS DE FIN DE REPOS ---
// QStash rappelle /fire à la fin du repos, puis le serveur envoie le push au téléphone.
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'https://moggtrack.vercel.app').trim();
const QSTASH_TOKEN = (process.env.QSTASH_TOKEN || '').trim();
const QSTASH_URL = (process.env.QSTASH_URL || 'https://qstash.upstash.io').trim().replace(/\/+$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const pushConfigured = () => !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && QSTASH_TOKEN);

// Appelé par QStash, donc sans mot de passe : l'identifiant aléatoire du minuteur sert de preuve
app.post('/api/rest-timer/:id/fire', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Minuteur introuvable' });
  try {
    await ensureMongo();
    const timer = await restTimersCol.findOne({ id: req.params.id });
    if (!timer) return res.json({ sent: false }); // annulé ou remplacé entre-temps
    const payload = JSON.stringify({
      title: 'Repos terminé',
      body: (timer.label ? timer.label + ' : ' : '') + 'c\'est reparti !'
    });
    await webpush.sendNotification(timer.subscription, payload, {
      vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
      TTL: 120,
      urgency: 'high'
    });
    await restTimersCol.deleteOne({ id: timer.id });
    res.json({ sent: true });
  } catch (e) {
    // Abonnement expiré : inutile de réessayer, l'appli se réabonne au prochain repos
    if (e.statusCode === 404 || e.statusCode === 410) {
      await restTimersCol.deleteOne({ id: req.params.id }).catch(() => {});
      return res.json({ sent: false, expired: true });
    }
    reportError('push', e);
    res.status(502).json({ error: 'Envoi de la notification impossible' }); // QStash retentera
  }
});

// --- ÉTAT DU SERVEUR ---
// Public et sans donnée personnelle : surveillé chaque heure par .github/workflows/health.yml
const HEALTH_MAX_RECENT_ERRORS = 3;
app.get('/api/health', async (req, res) => {
  const checks = { database: false, password: !!APP_PASSWORD, notifications: pushConfigured(), recentErrors: 0 };
  try {
    await ensureMongo();
    await db.command({ ping: 1 });
    checks.database = true;
    checks.recentErrors = await appErrorsCol.countDocuments({ at: { $gte: new Date(Date.now() - 60 * 60 * 1000) } });
  } catch (e) {
    console.error('Contrôle de santé :', e.message);
  }
  const ok = checks.database && checks.password && checks.notifications && checks.recentErrors < HEALTH_MAX_RECENT_ERRORS;
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({ ok, checks });
});

// Sur Vercel, une requête peut arriver avant la fin de la connexion
app.use('/api', async (req, res, next) => {
  if (!APP_PASSWORD) return res.status(503).json(NO_PASSWORD);
  try {
    await ensureMongo();
  } catch (e) {
    console.error('Erreur MongoDB:', e);
    return res.status(500).json({
      error: 'Erreur MongoDB',
      detail: `${e.name}: ${String(e.message).slice(0, 200)}`
    });
  }
  next();
});

app.use('/api', async (req, res, next) => {
  try {
    const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    req.device = await authenticate(token);
    if (!req.device) return res.status(401).json({ error: 'Non autorisé', code: 'UNAUTHORIZED' });
    next();
  } catch (e) {
    next(e);
  }
});

// --- VALIDATION DES DONNÉES ---
function cleanText(v, max) {
  return (v ?? '').toString().trim().slice(0, max);
}

function toInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Reps / poids : "" = série pas encore faite. On garde le type envoyé (texte ou nombre).
// La virgule est acceptée : sans ça, parseFloat('82,5') donnerait 82
function cleanAmount(v, max) {
  if (v === '' || v == null) return '';
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  const clamped = Math.max(0, Math.min(max, n));
  return typeof v === 'string' ? String(clamped) : clamped;
}

function cleanSessionBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 50).map(b => ({
    type: b && b.type === 'superset' ? 'superset' : 'single',
    exercises: Array.isArray(b && b.exercises) ? b.exercises.slice(0, 20).map(ex => ({
      name: cleanText(ex && ex.name, 200),
      rest: toInt(ex && ex.rest, 0, 3600, 0),
      note: cleanText(ex && ex.note, 500),
      sets: Array.isArray(ex && ex.sets) ? ex.sets.slice(0, 50).map(set => ({
        reps: cleanAmount(set && set.reps, 9999),
        weight: cleanAmount(set && set.weight, 9999),
        target: cleanText(set && set.target, 20),
        done: !!(set && set.done)
      })) : []
    })) : []
  }));
}

function cleanTemplateSessions(list) {
  return list.slice(0, 21).map(s => ({
    name: cleanText(s && s.name, 200),
    dayOfWeek: toInt(s && s.dayOfWeek, 1, 7, 1),
    blocks: (Array.isArray(s && s.blocks) ? s.blocks : []).slice(0, 50).map(b => ({
      type: b && b.type === 'superset' ? 'superset' : 'single',
      exercises: (Array.isArray(b && b.exercises) ? b.exercises : []).slice(0, 20).map(ex => ({
        name: cleanText(ex && ex.name, 200),
        setsCount: toInt(ex && ex.setsCount, 1, 20, 4),
        reps: cleanText(ex && ex.reps, 20),
        rest: toInt(ex && ex.rest, 0, 3600, 0),
        note: cleanText(ex && ex.note, 500)
      }))
    }))
  }));
}

// Enveloppe les routes async : une seule gestion d'erreur au lieu d'un try/catch par route
const route = fn => (req, res, next) => fn(req, res).catch(next);

// --- APPAREILS CONNECTÉS ---
app.get('/api/devices', route(async (req, res) => {
  const devices = await devicesCol.find({}, NO_ID).toArray();
  res.json(devices
    .map(d => ({ id: d.id, name: d.name, lastSeen: d.lastSeen, current: d.id === req.device.id }))
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)));
}));

app.post('/api/devices/logout-all', route(async (req, res) => {
  await devicesCol.deleteMany({});
  res.json({ message: 'Tous les appareils sont déconnectés' });
}));

app.delete('/api/devices/:id', route(async (req, res) => {
  const result = await devicesCol.deleteOne({ id: req.params.id });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Appareil introuvable' });
  res.json({ message: 'Appareil déconnecté' });
}));

// --- SÉANCES ---
app.get('/api/sessions', route(async (req, res) => {
  // ?from=AAAA-MM-JJ&to=AAAA-MM-JJ (optionnels) pour ne charger qu'une période
  const filter = {};
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (DATE_RE.test(from) || DATE_RE.test(to)) {
    filter.date = {};
    if (DATE_RE.test(from)) filter.date.$gte = from;
    if (DATE_RE.test(to)) filter.date.$lte = to;
  }
  res.json(await sessionsCol.find(filter, NO_ID).toArray());
}));

app.get('/api/sessions/:id', route(async (req, res) => {
  const session = await sessionsCol.findOne({ id: req.params.id }, NO_ID);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });
  res.json(session);
}));

app.post('/api/sessions', route(async (req, res) => {
  const body = req.body || {};
  const date = cleanText(body.date, 10);
  const name = cleanText(body.name, 200);
  if (!DATE_RE.test(date) || !name) {
    return res.status(400).json({ error: 'Indique une date valide (AAAA-MM-JJ) et un nom de séance' });
  }
  const session = { id: crypto.randomUUID(), date, name, blocks: cleanSessionBlocks(body.blocks) };
  await sessionsCol.insertOne({ ...session });
  res.status(201).json(session);
}));

// Crée la séance si l'identifiant est nouveau : une séance préparée hors connexion
// arrive ainsi avec l'identifiant choisi sur le téléphone, et un renvoi ne crée pas de doublon.
app.put('/api/sessions/:id', route(async (req, res) => {
  const body = req.body || {};
  // Seuls les champs envoyés sont modifiés (templateName / weekType sont conservés)
  const update = {};
  if (body.date !== undefined) {
    const date = cleanText(body.date, 10);
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Date invalide (AAAA-MM-JJ attendu)' });
    update.date = date;
  }
  if (body.name !== undefined) {
    const name = cleanText(body.name, 200);
    if (!name) return res.status(400).json({ error: 'Le nom de la séance est requis' });
    update.name = name;
  }
  if (body.blocks !== undefined) update.blocks = cleanSessionBlocks(body.blocks);
  if (typeof body.completed === 'boolean') update.completed = body.completed;
  // Une séance dupliquée garde la semaine type dont elle vient
  if (typeof body.templateName === 'string') update.templateName = cleanText(body.templateName, 200);
  if (typeof body.weekType === 'string') update.weekType = cleanText(body.weekType, 100);
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Aucune modification reçue' });

  const canCreate = UUID_RE.test(req.params.id) && !!update.date && !!update.name;
  const result = await sessionsCol.findOneAndUpdate(
    { id: req.params.id },
    { $set: update },
    { returnDocument: 'after', upsert: canCreate, ...NO_ID }
  );
  if (!result) return res.status(404).json({ error: 'Séance introuvable' });
  res.json(result);
}));

app.delete('/api/sessions/:id', route(async (req, res) => {
  const result = await sessionsCol.deleteOne({ id: req.params.id });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Séance introuvable' });
  res.json({ message: 'Séance supprimée' });
}));

// --- TEMPLATES (semaines types) ---
app.get('/api/templates', route(async (req, res) => {
  res.json(await templatesCol.find({}, NO_ID).toArray());
}));

app.post('/api/templates', route(async (req, res) => {
  const { name, weekType, sessions: tplSessions } = req.body || {};
  if (!cleanText(name, 200) || !Array.isArray(tplSessions)) {
    return res.status(400).json({ error: 'Données invalides : nom et séances requis' });
  }
  const tpl = {
    id: crypto.randomUUID(),
    name: cleanText(name, 200),
    weekType: cleanText(weekType, 100),
    sessions: cleanTemplateSessions(tplSessions)
  };
  await templatesCol.insertOne({ ...tpl });
  res.status(201).json(tpl);
}));

app.put('/api/templates/:id', route(async (req, res) => {
  const { name, weekType, sessions: tplSessions } = req.body || {};
  const update = {};
  if (cleanText(name, 200)) update.name = cleanText(name, 200);
  if (weekType !== undefined) update.weekType = cleanText(weekType, 100);
  if (Array.isArray(tplSessions)) update.sessions = cleanTemplateSessions(tplSessions);
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Aucune modification reçue' });

  const canCreate = UUID_RE.test(req.params.id) && !!update.name && !!update.sessions;
  const result = await templatesCol.findOneAndUpdate(
    { id: req.params.id },
    { $set: update },
    { returnDocument: 'after', upsert: canCreate, ...NO_ID }
  );
  if (!result) return res.status(404).json({ error: 'Template introuvable' });
  res.json(result);
}));

app.delete('/api/templates/:id', route(async (req, res) => {
  const result = await templatesCol.deleteOne({ id: req.params.id });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Template introuvable' });
  res.json({ message: 'Template supprimé' });
}));

// --- Appliquer un template à une semaine ---
app.post('/api/templates/:id/apply', route(async (req, res) => {
  const tpl = await templatesCol.findOne({ id: req.params.id }, NO_ID);
  if (!tpl) return res.status(404).json({ error: 'Template introuvable' });
  const weekStart = cleanText((req.body || {}).weekStart, 10); // "2026-03-23" (lundi)
  if (!DATE_RE.test(weekStart)) return res.status(400).json({ error: 'weekStart requis (AAAA-MM-JJ)' });

  // Calcul en UTC pour éviter tout décalage d'un jour selon le fuseau du serveur
  const created = (tpl.sessions || []).map(tplSession => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + (tplSession.dayOfWeek - 1));
    return {
      id: crypto.randomUUID(),
      date: d.toISOString().slice(0, 10),
      name: tplSession.name,
      // Mémorise la semaine type d'origine pour l'afficher dans le calendrier
      templateName: tpl.name,
      weekType: tpl.weekType || '',
      blocks: (tplSession.blocks || []).map(b => ({
        type: b.type,
        exercises: (b.exercises || []).map(ex => ({
          name: ex.name,
          rest: ex.rest || 0,
          note: ex.note || '',
          // Séries planifiées : objectif de reps, charges à remplir à la salle
          sets: Array.from({ length: ex.setsCount || 4 }, () => ({ reps: '', weight: '', target: ex.reps || '' }))
        }))
      }))
    };
  });

  // Une seule écriture pour toute la semaine
  if (created.length > 0) await sessionsCol.insertMany(created.map(s => ({ ...s })));
  res.status(201).json({ message: `${created.length} séances créées`, sessions: created });
}));

// --- MINUTEUR DE REPOS (notification) ---
const NO_PUSH = { error: 'notifications non configurées sur le serveur', code: 'PUSH_NOT_CONFIGURED' };

function cleanSubscription(sub) {
  const endpoint = sub && sub.endpoint;
  const keys = sub && sub.keys;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 2048) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 256 || keys.auth.length > 256) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

app.get('/api/push-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(503).json(NO_PUSH);
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.post('/api/rest-timer', route(async (req, res) => {
  if (!pushConfigured()) return res.status(503).json(NO_PUSH);
  const body = req.body || {};
  const subscription = cleanSubscription(body.subscription);
  if (!subscription) return res.status(400).json({ error: 'Abonnement aux notifications invalide' });
  const seconds = toInt(body.seconds, 1, 3600, 0);
  if (!seconds) return res.status(400).json({ error: 'Durée de repos invalide' });

  // +15 / -15 : l'ancien minuteur est retiré, son rappel QStash ne fera plus rien
  if (UUID_RE.test(String(body.replaces || ''))) await restTimersCol.deleteOne({ id: body.replaces });

  const id = crypto.randomUUID();
  await restTimersCol.insertOne({
    id,
    label: cleanText(body.label, 100),
    subscription,
    expireAt: new Date(Date.now() + (seconds + 3600) * 1000)
  });

  const proto = req.get('x-forwarded-proto') || req.protocol;
  const origin = PUBLIC_URL || `${proto}://${req.get('host')}`;
  const scheduled = await fetch(`${QSTASH_URL}/v2/publish/${origin}/api/rest-timer/${id}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      'Upstash-Delay': `${seconds}s`,
      'Upstash-Retries': '1'
    }
  });
  if (!scheduled.ok) {
    await restTimersCol.deleteOne({ id });
    reportError('qstash', `${scheduled.status} ${(await scheduled.text()).slice(0, 200)}`);
    return res.status(502).json({ error: 'programmation refusée par QStash' });
  }
  res.status(201).json({ id });
}));

app.delete('/api/rest-timer/:id', route(async (req, res) => {
  await restTimersCol.deleteOne({ id: req.params.id });
  res.json({ message: 'Minuteur annulé' });
}));

// --- TOP PERFS ---
function flattenExercises(session) {
  const all = [];
  if (!session.blocks) return all;
  session.blocks.forEach(block => {
    (block.exercises || []).forEach(ex => all.push(ex));
  });
  return all;
}
// Même exercice malgré la casse, les accents ou les espaces
function exerciseKey(name) {
  return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

app.get('/api/top-perfs', route(async (req, res) => {
  // Seuls les champs utiles au calcul sont lus
  const sessions = await sessionsCol
    .find({}, { projection: { _id: 0, id: 1, name: 1, date: 1, blocks: 1 } })
    .toArray();
  const perfs = {};
  sessions.forEach(session => {
    flattenExercises(session).forEach(ex => {
      const key = exerciseKey(ex.name);
      (ex.sets || []).forEach(set => {
        const weight = Number(set.weight) || 0;
        const reps = Number(set.reps) || 0;
        if (!key || (!weight && !reps)) return; // série pas encore faite
        if (!perfs[key] || weight > perfs[key].weight ||
           (weight === perfs[key].weight && reps > perfs[key].reps)) {
          perfs[key] = {
            exercise: ex.name.trim(),
            weight,
            reps,
            sessionId: session.id,
            sessionName: session.name,
            date: session.date
          };
        }
      });
    });
  });
  res.json(Object.values(perfs).sort((a, b) => a.exercise.localeCompare(b.exercise, 'fr')));
}));

// --- EXPORT ---
// « ; » et BOM : le fichier s'ouvre directement dans Excel en français.
// Une cellule commençant par = + - @ serait exécutée comme une formule : on la neutralise.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function sessionsToCsv(sessions) {
  const rows = [['Date', 'Séance', 'Terminée', 'Bloc', 'Exercice', 'Repos (s)', 'Série', 'Objectif', 'Reps', 'Poids (kg)', 'Validée', 'Note']];
  [...sessions].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(s => {
    (s.blocks || []).forEach(b => (b.exercises || []).forEach(ex => (ex.sets || []).forEach((set, i) => {
      rows.push([
        s.date, s.name, s.completed ? 'oui' : 'non', b.type === 'superset' ? 'superset' : 'simple',
        ex.name, ex.rest || 0, i + 1, set.target || '', set.reps ?? '', set.weight ?? '', set.done ? 'oui' : 'non', ex.note || ''
      ]);
    })));
  });
  return '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

app.get('/api/export', route(async (req, res) => {
  const sessions = await sessionsCol.find({}, NO_ID).toArray();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="moggtrack-${stamp}.csv"`);
    return res.send(sessionsToCsv(sessions));
  }
  const templates = await templatesCol.find({}, NO_ID).toArray();
  res.setHeader('Content-Disposition', `attachment; filename="moggtrack-${stamp}.json"`);
  res.json({ exportedAt: new Date().toISOString(), sessions, templates });
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API inconnue' });
});

// Erreurs non prévues : JSON invalide (400), trop gros (413) ou erreur serveur (500)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps de requête JSON invalide' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
  reportError('server', err);
  res.status(500).json({ error: 'Erreur serveur, réessaie dans un instant' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
  });
}

module.exports = app;
module.exports.sessionDay = sessionDay;
