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
let db, sessionsCol, templatesCol, restTimersCol, devicesCol, loginAttemptsCol, appErrorsCol, integrationsCol;

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
  integrationsCol = db.collection('integrations');
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
    [integrationsCol, { id: 1 }, { unique: true, name: 'id_unique' }],
    // Une activité Strava n'est importée qu'une fois, même si deux synchronisations se croisent
    [sessionsCol, { 'run.stravaId': 1 }, { unique: true, name: 'strava_id_unique', partialFilterExpression: { 'run.stravaId': { $type: 'string' } } }],
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
// Tolère les erreurs de copier-coller depuis le bloc .env d'Upstash :
// « QSTASH_TOKEN="…" », guillemets, espaces ou retours à la ligne en trop
function cleanEnvValue(raw, name) {
  return String(raw || '')
    .trim()
    .replace(new RegExp(`^${name}\\s*=\\s*`, 'i'), '')
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, '');
}
const QSTASH_TOKEN = cleanEnvValue(process.env.QSTASH_TOKEN, 'QSTASH_TOKEN');
const QSTASH_URL = (cleanEnvValue(process.env.QSTASH_URL, 'QSTASH_URL') || 'https://qstash.upstash.io').replace(/\/+$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const pushConfigured = () => !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && QSTASH_TOKEN);

// Appelé par QStash, donc sans mot de passe : l'identifiant aléatoire du minuteur sert de preuve
app.post('/api/rest-timer/:id/fire', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Minuteur introuvable' });
  let timer = null;
  try {
    await ensureMongo();
    // Le minuteur est retiré AVANT l'envoi, en une seule opération : si QStash rappelle
    // deux fois (il peut le faire), le second rappel ne trouve plus rien et n'envoie pas de doublon
    timer = await restTimersCol.findOneAndDelete({ id: req.params.id });
    if (!timer) return res.json({ sent: false }); // annulé, remplacé ou déjà envoyé
    const payload = JSON.stringify({
      title: 'Repos terminé',
      body: (timer.label ? timer.label + ' : ' : '') + 'c\'est reparti !'
    });
    await webpush.sendNotification(timer.subscription, payload, {
      vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
      TTL: 120,
      urgency: 'high'
    });
    res.json({ sent: true });
  } catch (e) {
    // Abonnement expiré : inutile de réessayer, l'appli se réabonne au prochain repos
    if (e.statusCode === 404 || e.statusCode === 410) return res.json({ sent: false, expired: true });
    // Erreur temporaire : le minuteur est remis en place pour que la nouvelle tentative de QStash l'envoie
    if (timer) await restTimersCol.insertOne(timer).catch(() => {});
    reportError('push', e);
    res.status(502).json({ error: 'Envoi de la notification impossible' }); // QStash retentera
  }
});

// --- ÉTAT DU SERVEUR ---
// Public et sans donnée personnelle : surveillé chaque heure par .github/workflows/health.yml
const HEALTH_MAX_RECENT_ERRORS = 3;
// Le jeton QStash est vérifié par une simple lecture (aucun message envoyé), au plus toutes les 5 min.
// Un jeton ne marche que dans sa région : si QSTASH_URL le refuse, les autres régions sont essayées
// et la première qui l'accepte sert ensuite à programmer les notifications.
const QSTASH_CHECK_MS = 5 * 60 * 1000;
const QSTASH_REGION_URLS = (process.env.QSTASH_REGION_URLS ||
  'https://qstash-eu-central-1.upstash.io,https://qstash-us-east-1.upstash.io,https://qstash.upstash.io')
  .split(',').map(u => u.trim().replace(/\/+$/, '')).filter(Boolean);
let qstashCheck = { at: 0, ok: null };
let qstashBase = QSTASH_URL;

// Forme attendue : base64 d'un JSON { UserID, Password }. On n'en révèle jamais le contenu.
function qstashTokenShape(token) {
  if (!token) return 'absent';
  try {
    const json = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    return json && json.UserID && json.Password ? 'valide' : 'inattendue';
  } catch (e) {
    return 'mal formée';
  }
}
function qstashRegionName(base) {
  const host = new URL(base).host;
  const match = host.match(/^qstash-([a-z0-9-]+)\.upstash\.io$/);
  if (match) return match[1];
  return host === 'qstash.upstash.io' ? 'globale' : host;
}
async function qstashTokenWorks(force) {
  if (!QSTASH_TOKEN) return false;
  if (!force && Date.now() - qstashCheck.at < QSTASH_CHECK_MS) return qstashCheck.ok;
  let reached = false;
  for (const base of [QSTASH_URL, ...QSTASH_REGION_URLS.filter(u => u !== QSTASH_URL)]) {
    try {
      const res = await fetch(`${base}/v2/schedules`, {
        headers: { Authorization: `Bearer ${QSTASH_TOKEN}` },
        signal: AbortSignal.timeout(5000)
      });
      reached = true;
      if (res.ok) {
        if (base !== qstashBase) console.warn(`QStash : jeton accepté par ${base} (QSTASH_URL = ${QSTASH_URL})`);
        qstashBase = base;
        qstashCheck = { at: Date.now(), ok: true };
        return true;
      }
    } catch (e) {
      // Région injoignable : on passe à la suivante
    }
  }
  // QStash totalement injoignable : on ne conclut pas que le jeton est faux, on retentera
  if (!reached) return null;
  qstashCheck = { at: Date.now(), ok: false };
  return false;
}
app.get('/api/health', async (req, res) => {
  const qstash = await qstashTokenWorks();
  const checks = {
    database: false,
    password: !!APP_PASSWORD,
    notifications: pushConfigured(),
    qstash,
    qstashToken: qstashTokenShape(QSTASH_TOKEN),
    // Empreinte non réversible (8 caractères) : permet de comparer avec le jeton affiché sur Upstash
    qstashTokenId: QSTASH_TOKEN ? crypto.createHash('sha256').update(QSTASH_TOKEN).digest('hex').slice(0, 8) : null,
    qstashRegion: qstash ? qstashRegionName(qstashBase) : null,
    recentErrors: 0
  };
  try {
    await ensureMongo();
    await db.command({ ping: 1 });
    checks.database = true;
    checks.recentErrors = await appErrorsCol.countDocuments({ at: { $gte: new Date(Date.now() - 60 * 60 * 1000) } });
  } catch (e) {
    console.error('Contrôle de santé :', e.message);
  }
  const ok = checks.database && checks.password && checks.notifications && checks.qstash !== false
    && checks.recentErrors < HEALTH_MAX_RECENT_ERRORS;
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({ ok, checks });
});

// Strava vérifie l'adresse des alertes en renvoyant le « hub.challenge » (réponse attendue en moins de 2 s)
const stravaVerifyToken = () => signToken('strava-webhook');
app.get('/api/strava/webhook', (req, res) => {
  const token = String(req.query['hub.verify_token'] || '');
  if (req.query['hub.mode'] !== 'subscribe' || !APP_PASSWORD || !safeEqual(token, stravaVerifyToken())) {
    return res.status(403).json({ error: 'Vérification refusée' });
  }
  res.json({ 'hub.challenge': String(req.query['hub.challenge'] || '') });
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

// --- STRAVA ---
// Les courses enregistrées sur Strava (téléphone ou Apple Watch) arrivent dans l'appli.
// Les jetons Strava restent sur le serveur : le téléphone ne les voit jamais.
const STRAVA_CLIENT_ID = cleanEnvValue(process.env.STRAVA_CLIENT_ID, 'STRAVA_CLIENT_ID');
const STRAVA_CLIENT_SECRET = cleanEnvValue(process.env.STRAVA_CLIENT_SECRET, 'STRAVA_CLIENT_SECRET');
const STRAVA_URL = (process.env.STRAVA_URL || 'https://www.strava.com').trim().replace(/\/+$/, '');
const STRAVA_SCOPE = 'read,activity:read_all';
const STRAVA_STATE_MS = 15 * 60 * 1000;
const STRAVA_SYNC_MIN_MS = 3 * 60 * 1000;     // synchronisation automatique au plus toutes les 3 min
const STRAVA_FIRST_SYNC_DAYS = 60;             // première synchronisation : les 2 derniers mois
const STRAVA_OVERLAP_S = 3 * 24 * 3600;        // une activité envoyée en retard est quand même vue
const STRAVA_RUN_SPORTS = ['Run', 'TrailRun', 'VirtualRun'];
const stravaConfigured = () => !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET);

function publicOrigin(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return PUBLIC_URL || `${proto}://${req.get('host')}`;
}
// Le paramètre « state » prouve que la demande vient de l'appli (connectée) et qu'elle est récente
function stravaState() {
  const exp = String(Date.now() + STRAVA_STATE_MS);
  return `${exp}.${signToken(`strava:${exp}`)}`;
}
function validStravaState(state) {
  const [exp, sig] = String(state || '').split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && safeEqual(sig, signToken(`strava:${exp}`));
}
async function stravaFetch(pathname, options = {}) {
  const res = await fetch(STRAVA_URL + pathname, { ...options, signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Strava ${res.status} : ${String(data.message || '').slice(0, 120)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
function stravaTokenRequest(params) {
  return stravaFetch('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, ...params })
  });
}

// Page affichée à la fin de la connexion : elle peut s'ouvrir hors de l'appli installée
function stravaResultPage(res, ok, message) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 400).type('html').send(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>MoggTrack · Strava</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f4f4f5;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:1.4rem;margin:0 0 8px}p{color:#a1a1aa;margin:0 0 24px}a{display:inline-block;background:#c8f53b;color:#0b0d02;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:14px}</style>
</head><body><main><h1>${ok ? 'Strava connecté ✓' : 'Connexion à Strava impossible'}</h1><p>${message}</p>
<a href="/?strava=${ok ? 'connected' : 'error'}">Retourner dans MoggTrack</a></main></body></html>`);
}

// Appelé par Strava après l'autorisation : sans mot de passe, le « state » signé sert de preuve
app.get('/api/strava/callback', async (req, res) => {
  if (!stravaConfigured()) return stravaResultPage(res, false, 'Strava n\'est pas configuré sur le serveur.');
  if (!validStravaState(req.query.state)) return stravaResultPage(res, false, 'Lien expiré : relance la connexion depuis les réglages de l\'appli.');
  if (req.query.error) return stravaResultPage(res, false, 'Autorisation refusée sur Strava.');
  const scope = String(req.query.scope || '');
  if (!/activity:read/.test(scope)) {
    return stravaResultPage(res, false, 'Coche l\'accès à tes activités sur la page Strava, sinon l\'appli ne peut pas les lire.');
  }
  try {
    const token = await stravaTokenRequest({ code: String(req.query.code || ''), grant_type: 'authorization_code' });
    const athlete = token.athlete || {};
    await integrationsCol.findOneAndUpdate({ id: 'strava' }, {
      $set: {
        id: 'strava',
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Number(token.expires_at) || 0,
        scope,
        athleteId: athlete.id || null,
        athleteName: cleanText([athlete.firstname, athlete.lastname].filter(Boolean).join(' '), 100),
        connectedAt: new Date(),
        lastSyncAt: null
      }
    }, { upsert: true });
    // Import instantané : sans lui, les courses arrivent quand même à l'ouverture de l'appli
    try {
      await ensureStravaWebhook(publicOrigin(req));
    } catch (e) {
      reportError('strava', e);
    }
    stravaResultPage(res, true, 'Tes courses vont arriver dans l\'appli.');
  } catch (e) {
    reportError('strava', e);
    stravaResultPage(res, false, 'Strava n\'a pas validé la connexion. Réessaie dans un instant.');
  }
});

// Alerte envoyée par Strava (nouvelle activité, modification, accès retiré). Sans mot de passe :
// on vérifie le compte et l'abonnement, puis on relit l'activité chez Strava avec notre propre jeton.
app.post('/api/strava/webhook', async (req, res) => {
  const event = req.body || {};
  try {
    const link = stravaConfigured() && await integrationsCol.findOne({ id: 'strava' });
    const ours = link && String(event.owner_id) === String(link.athleteId)
      && (!link.webhookId || String(event.subscription_id) === String(link.webhookId));
    if (!ours) return res.json({ ok: true });
    if (event.object_type === 'athlete' && event.updates && String(event.updates.authorized) === 'false') {
      await integrationsCol.deleteOne({ id: 'strava' });
    } else if (event.object_type === 'activity' && ['create', 'update'].includes(event.aspect_type)) {
      await importStravaWebhookActivity(link, event.object_id, event.aspect_type);
    }
    res.json({ ok: true });
  } catch (e) {
    reportError('strava', e);
    res.status(500).json({ error: 'Import impossible pour le moment' }); // Strava renverra l'alerte
  }
});

// Clé d'export (variable EXPORT_KEY, 32 caractères minimum) : permet à une tâche automatique
// de lire l'export sans se connecter. Elle n'ouvre que GET /api/export, en lecture seule.
const EXPORT_KEY = (process.env.EXPORT_KEY || '').trim();
function hasExportKey(req) {
  const key = (req.get('X-Export-Key') || '').trim();
  return EXPORT_KEY.length >= 32 && key !== '' && req.method === 'GET' && req.path === '/export' && safeEqual(key, EXPORT_KEY);
}

app.use('/api', async (req, res, next) => {
  try {
    if (hasExportKey(req)) return next();
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

// --- COURSE À PIED ---
const RUN_TYPES = ['footing', 'fractionne', 'longue', 'tempo', 'course', 'autre'];
// Meilleurs efforts gardés (calculés par Strava à l'intérieur de chaque course)
const RUN_EFFORTS = ['1k', 'mile', '5k', '10k', 'semi', 'marathon'];
// Nombre positif borné, 0 sinon ; « 8,5 » est accepté comme 8.5
function cleanPositive(v, max, decimals = 0) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const f = 10 ** decimals;
  return Math.round(Math.min(n, max) * f) / f;
}
function cleanRunTarget(t) {
  return {
    distanceKm: cleanPositive(t && t.distanceKm, 500, 2),
    durationSec: cleanPositive(t && t.durationSec, 100 * 3600),
    details: cleanText(t && t.details, 300)
  };
}
// Objectif (prévu) et réalisé : distance en km, durée en secondes
function cleanRun(r) {
  const run = r && typeof r === 'object' ? r : {};
  const clean = {
    type: RUN_TYPES.includes(run.type) ? run.type : 'footing',
    target: cleanRunTarget(run.target),
    distanceKm: cleanPositive(run.distanceKm, 500, 2),
    durationSec: cleanPositive(run.durationSec, 100 * 3600),
    elevation: cleanPositive(run.elevation, 20000),
    avgHr: cleanPositive(run.avgHr, 250),
    maxHr: cleanPositive(run.maxHr, 250),
    feeling: toInt(run.feeling, 0, 5, 0),
    notes: cleanText(run.notes, 1000)
  };
  if (/^\d{1,20}$/.test(String(run.stravaId ?? ''))) clean.stravaId = String(run.stravaId);
  // Détails venus de Strava : temps par km et meilleurs efforts
  if (Array.isArray(run.splits)) {
    clean.splits = run.splits.slice(0, 200).map(sp => ({
      distance: cleanPositive(sp && sp.distance, 5000),
      sec: cleanPositive(sp && sp.sec, 36000),
      elev: Math.round(Math.max(-2000, Math.min(2000, Number(sp && sp.elev) || 0))),
      hr: cleanPositive(sp && sp.hr, 250)
    }));
  }
  if (Array.isArray(run.bestEfforts)) {
    clean.bestEfforts = run.bestEfforts.filter(e => e && RUN_EFFORTS.includes(e.key)).slice(0, RUN_EFFORTS.length)
      .map(e => ({ key: e.key, sec: cleanPositive(e.sec, 360000), pr: !!e.pr }));
  }
  if (run.detailed === true) clean.detailed = true;
  return clean;
}
const cleanKind = kind => (kind === 'run' ? 'run' : 'gym');

function cleanTemplateSessions(list) {
  return list.slice(0, 21).map(s => ({
    name: cleanText(s && s.name, 200),
    dayOfWeek: toInt(s && s.dayOfWeek, 1, 7, 1),
    kind: cleanKind(s && s.kind),
    ...(s && s.kind === 'run' ? { run: { type: cleanRun(s.run).type, target: cleanRunTarget(s.run && s.run.target) } } : {}),
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

// Abonnement de cet appareil aux notifications (ex. : course importée depuis Strava)
app.put('/api/devices/current/push', route(async (req, res) => {
  const subscription = cleanSubscription(req.body && req.body.subscription);
  if (!subscription) return res.status(400).json({ error: 'Abonnement aux notifications invalide' });
  await devicesCol.updateOne({ id: req.device.id }, { $set: { pushSubscription: subscription } });
  res.json({ message: 'Notifications activées sur cet appareil' });
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
  if (body.kind === 'run') Object.assign(session, { kind: 'run', run: cleanRun(body.run) });
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
  if (body.kind !== undefined) update.kind = cleanKind(body.kind);
  if (body.run !== undefined) update.run = cleanRun(body.run);
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
      // Course prévue : l'objectif est repris, le réalisé arrivera de Strava ou de la saisie
      ...(tplSession.kind === 'run' ? { kind: 'run', run: cleanRun({ type: tplSession.run && tplSession.run.type, target: tplSession.run && tplSession.run.target }) } : {}),
      blocks: tplSession.kind === 'run' ? [] : (tplSession.blocks || []).map(b => ({
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
  // Utilise la région qui accepte le jeton (déterminée une fois, puis gardée en mémoire)
  await qstashTokenWorks();
  const scheduled = await fetch(`${qstashBase}/v2/publish/${origin}/api/rest-timer/${id}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      'Upstash-Delay': `${seconds}s`,
      'Upstash-Retries': '1'
    }
  });
  if (!scheduled.ok) {
    await restTimersCol.deleteOne({ id });
    const text = (await scheduled.text()).slice(0, 200);
    reportError('qstash', `${scheduled.status} ${text}`);
    if (scheduled.status === 401) qstashCheck.at = 0; // jeton changé ou révoqué : on revérifiera
    // La raison donnée par QStash (ex. « invalid token ») aide à corriger la configuration sur Vercel
    let reason = text;
    try { reason = JSON.parse(text).error || text; } catch (e) {}
    reason = String(reason).replace(/[A-Za-z0-9_=-]{24,}/g, '…').slice(0, 120);
    return res.status(502).json({ error: `programmation refusée par QStash (${scheduled.status}${reason ? ' : ' + reason : ''})` });
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
  // Meilleure série de chaque séance, par exercice : le podium compare des séances différentes
  const better = (a, b) => a.weight > b.weight || (a.weight === b.weight && a.reps > b.reps);
  const bySession = {}; // exercice → séance → meilleure série
  sessions.forEach(session => {
    flattenExercises(session).forEach(ex => {
      const key = exerciseKey(ex.name);
      (ex.sets || []).forEach(set => {
        const weight = Number(set.weight) || 0;
        const reps = Number(set.reps) || 0;
        if (!key || (!weight && !reps)) return; // série pas encore faite
        const perExercise = bySession[key] || (bySession[key] = {});
        const current = perExercise[session.id];
        const candidate = { exercise: ex.name.trim(), weight, reps, sessionId: session.id, sessionName: session.name, date: session.date };
        if (!current || better(candidate, current)) perExercise[session.id] = candidate;
      });
    });
  });
  const perfs = Object.values(bySession).map(perExercise => {
    // À égalité, la perf la plus ancienne passe devant : c'est elle qui a établi le record
    const podium = Object.values(perExercise)
      .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : String(a.date).localeCompare(String(b.date))))
      .slice(0, 3);
    return { ...podium[0], podium };
  });
  res.json(perfs.sort((a, b) => a.exercise.localeCompare(b.exercise, 'fr')));
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
    if (s.kind === 'run' && s.run) {
      const r = s.run;
      const summary = [r.distanceKm && `${r.distanceKm} km`, r.durationSec && `${Math.round(r.durationSec / 60)} min`,
        r.elevation && `D+ ${r.elevation} m`, r.avgHr && `FC moy ${r.avgHr}`, r.maxHr && `FC max ${r.maxHr}`].filter(Boolean).join(' · ');
      const target = [r.target && r.target.distanceKm && `${r.target.distanceKm} km`, r.target && r.target.details].filter(Boolean).join(' · ');
      rows.push([s.date, s.name, s.completed ? 'oui' : 'non', 'course', r.type, '', '', target, '', '', s.completed ? 'oui' : 'non',
        [summary, r.notes].filter(Boolean).join(' · ')]);
      return;
    }
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

// --- STRAVA (routes connectées) ---
const NO_STRAVA = { error: 'Strava n\'est pas configuré sur le serveur', code: 'STRAVA_NOT_CONFIGURED' };

// Jeton d'accès valide (renouvelé si besoin), ou null si Strava a été déconnecté
async function stravaAccessToken(link) {
  if (link.expiresAt - 60 > Date.now() / 1000) return link.accessToken;
  try {
    const token = await stravaTokenRequest({ grant_type: 'refresh_token', refresh_token: link.refreshToken });
    await integrationsCol.updateOne({ id: 'strava' }, {
      $set: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Number(token.expires_at) || 0 }
    });
    return token.access_token;
  } catch (e) {
    // Accès retiré depuis Strava : il faudra reconnecter
    if (e.status === 400 || e.status === 401) {
      await integrationsCol.deleteOne({ id: 'strava' });
      return null;
    }
    throw e;
  }
}

// Type de course d'après Strava (compétition, sortie longue, entraînement), sinon celui prévu
function stravaRunType(activity, planned) {
  const byWorkout = { 1: 'course', 2: 'longue', 3: 'fractionne' }[activity.workout_type];
  return byWorkout || (planned && planned.run && planned.run.type) || 'footing';
}
const STRAVA_EFFORT_KEYS = { '1K': '1k', '1 mile': 'mile', '5K': '5k', '10K': '10k', 'Half-Marathon': 'semi', 'Marathon': 'marathon' };
const STRAVA_DETAILS_PER_SYNC = 30; // reste loin des limites de l'API Strava (100 requêtes / 15 min)
// detailed : l'activité complète a été lue (temps par km et meilleurs efforts, s'il y en a)
function stravaRunFields(a, detailed) {
  const fields = {
    distanceKm: (Number(a.distance) || 0) / 1000,
    durationSec: Number(a.moving_time) || Number(a.elapsed_time) || 0,
    elevation: Number(a.total_elevation_gain) || 0,
    avgHr: Number(a.average_heartrate) || 0,
    maxHr: Number(a.max_heartrate) || 0,
    stravaId: String(a.id)
  };
  if (detailed) {
    fields.detailed = true;
    fields.splits = (Array.isArray(a.splits_metric) ? a.splits_metric : []).map(sp => ({
      distance: sp.distance, sec: sp.moving_time || sp.elapsed_time, elev: sp.elevation_difference, hr: sp.average_heartrate
    }));
    fields.bestEfforts = (Array.isArray(a.best_efforts) ? a.best_efforts : [])
      .filter(e => STRAVA_EFFORT_KEYS[e.name])
      .map(e => ({ key: STRAVA_EFFORT_KEYS[e.name], sec: e.elapsed_time, pr: e.pr_rank === 1 }));
  }
  return fields;
}
// Activité complète, ou null si elle n'existe plus
async function stravaActivity(token, id) {
  try {
    return await stravaFetch(`/api/v3/activities/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
// Ajoute une course : complète la course prévue ce jour-là, sinon crée une séance. null si déjà importée.
async function importStravaRun(a, detailed, known) {
  const date = String(a.start_date_local || '').slice(0, 10);
  if (!DATE_RE.test(date)) return null;
  const planned = known.find(s => s.date === date && !s.completed && !(s.run && s.run.stravaId));
  try {
    if (planned) {
      // Objectif, ressenti et notes déjà saisis sont gardés
      const run = cleanRun({ ...planned.run, ...stravaRunFields(a, detailed), type: stravaRunType(a, planned) });
      await sessionsCol.updateOne({ id: planned.id }, { $set: { run, completed: true } });
      Object.assign(planned, { run, completed: true });
      return { status: 'completed', session: planned };
    }
    const session = {
      id: crypto.randomUUID(),
      date,
      name: cleanText(a.name, 200) || 'Course',
      kind: 'run',
      run: cleanRun({ ...stravaRunFields(a, detailed), type: stravaRunType(a) }),
      blocks: [],
      completed: true
    };
    await sessionsCol.insertOne({ ...session });
    known.push(session);
    return { status: 'created', session };
  } catch (e) {
    if (e.code === 11000) return null; // déjà importée par une synchronisation simultanée
    throw e;
  }
}

// --- NOTIFICATION « COURSE IMPORTÉE » ---
function formatClock(sec) {
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s2 = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}`;
}
function runNotificationBody(session) {
  const r = session.run || {};
  const parts = [];
  if (r.distanceKm) parts.push(`${String(r.distanceKm).replace('.', ',')} km`);
  if (r.durationSec) parts.push(`en ${formatClock(r.durationSec)}`);
  if (r.distanceKm && r.durationSec) parts.push(`· ${formatClock(r.durationSec / r.distanceKm)} /km`);
  const records = (r.bestEfforts || []).filter(e => e.pr).length;
  return `${session.name} : ${parts.join(' ')}${records ? ` · ${records} record${records > 1 ? 's' : ''} perso 🏆` : ''}`;
}
// Envoyée à chaque appareil abonné ; un abonnement expiré est oublié
async function notifyDevices(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const devices = (await devicesCol.find({}, NO_ID).toArray()).filter(d => d.pushSubscription);
  await Promise.all(devices.map(async device => {
    try {
      await webpush.sendNotification(device.pushSubscription, JSON.stringify(payload), {
        vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
        TTL: 6 * 3600
      });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await devicesCol.updateOne({ id: device.id }, { $set: { pushSubscription: null } });
      } else {
        reportError('push', e);
      }
    }
  }));
}

// Alerte Strava : lit l'activité, l'importe si c'est une course, puis prévient le téléphone
async function importStravaWebhookActivity(link, activityId, aspect) {
  if (!/^\d{1,20}$/.test(String(activityId))) return;
  const token = await stravaAccessToken(link);
  if (!token) return;
  const a = await stravaActivity(token, activityId);
  if (!a || !STRAVA_RUN_SPORTS.includes(a.sport_type || a.type)) return;
  if (a.athlete && String(a.athlete.id) !== String(link.athleteId)) return; // activité d'un autre compte
  const known = await sessionsCol.find({ kind: 'run' }, NO_ID).toArray();
  const existing = known.find(s => s.run && s.run.stravaId === String(a.id));
  if (existing) {
    // Activité modifiée sur Strava (ex. : distance corrigée) : les chiffres sont mis à jour
    if (aspect === 'update') {
      await sessionsCol.updateOne({ id: existing.id }, { $set: { run: cleanRun({ ...existing.run, ...stravaRunFields(a, true) }) } });
    }
    return;
  }
  const result = await importStravaRun(a, true, known);
  if (result) {
    await notifyDevices({ title: 'Course importée 🏃', body: runNotificationBody(result.session), tag: 'strava-run' });
  }
}

// Abonne l'appli aux alertes Strava (un seul abonnement par application Strava)
async function ensureStravaWebhook(origin) {
  const callbackUrl = `${origin}/api/strava/webhook`;
  const auth = new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET });
  const existing = await stravaFetch(`/api/v3/push_subscriptions?${auth}`);
  for (const sub of Array.isArray(existing) ? existing : []) {
    if (sub.callback_url === callbackUrl) {
      await integrationsCol.updateOne({ id: 'strava' }, { $set: { webhookId: sub.id } });
      return sub.id;
    }
    await stravaFetch(`/api/v3/push_subscriptions/${sub.id}?${auth}`, { method: 'DELETE' });
  }
  const created = await stravaFetch('/api/v3/push_subscriptions', {
    method: 'POST',
    body: new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, callback_url: callbackUrl, verify_token: stravaVerifyToken() })
  });
  await integrationsCol.updateOne({ id: 'strava' }, { $set: { webhookId: created.id } });
  return created.id;
}
async function removeStravaWebhook() {
  const auth = new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET });
  const existing = await stravaFetch(`/api/v3/push_subscriptions?${auth}`);
  for (const sub of Array.isArray(existing) ? existing : []) {
    await stravaFetch(`/api/v3/push_subscriptions/${sub.id}?${auth}`, { method: 'DELETE' });
  }
}

// Importe les courses Strava : une course prévue le même jour est complétée, sinon une séance est créée
async function syncStrava(link) {
  const token = await stravaAccessToken(link);
  if (!token) return { connected: false };
  const nowS = Math.floor(Date.now() / 1000);
  const lastS = link.lastSyncAt ? Math.floor(new Date(link.lastSyncAt).getTime() / 1000) : 0;
  const after = lastS ? lastS - STRAVA_OVERLAP_S : nowS - STRAVA_FIRST_SYNC_DAYS * 86400;
  const startedAt = new Date();

  const activities = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await stravaFetch(`/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!Array.isArray(batch)) break;
    activities.push(...batch);
    if (batch.length < 100) break;
  }
  const runs = activities
    .filter(a => STRAVA_RUN_SPORTS.includes(a.sport_type || a.type) && a.start_date_local)
    .sort((a, b) => String(a.start_date_local).localeCompare(String(b.start_date_local)));

  const known = await sessionsCol.find({ kind: 'run' }, NO_ID).toArray();
  const imported = new Set(known.map(s => s.run && s.run.stravaId).filter(Boolean));
  let created = 0, completed = 0, enriched = 0;
  let detailsLeft = STRAVA_DETAILS_PER_SYNC;
  const asked = new Set(); // une même synchronisation ne relit jamais une activité
  for (const summary of runs) {
    if (imported.has(String(summary.id))) continue;
    imported.add(String(summary.id));
    // L'activité complète apporte les temps par km et les meilleurs efforts
    let a = summary, detailed = false;
    if (detailsLeft > 0) {
      detailsLeft--;
      asked.add(String(summary.id));
      const full = await stravaActivity(token, summary.id);
      if (full) { a = { ...summary, ...full }; detailed = true; }
    }
    const result = await importStravaRun(a, detailed, known);
    if (result && result.status === 'created') created++;
    if (result && result.status === 'completed') completed++;
  }
  // Courses importées sans leurs détails (avant cette fonction, ou au-delà de la limite) : complétées petit à petit
  for (const s of known.filter(k => k.run && k.run.stravaId && !k.run.detailed && !asked.has(k.run.stravaId))) {
    if (detailsLeft-- <= 0) break;
    const full = await stravaActivity(token, s.run.stravaId);
    const run = cleanRun({ ...s.run, ...(full ? stravaRunFields(full, true) : {}), detailed: true });
    await sessionsCol.updateOne({ id: s.id }, { $set: { run } });
    s.run = run;
    enriched++;
  }
  // Notée seulement si tout s'est bien passé : un échec ne fait rien perdre
  await integrationsCol.updateOne({ id: 'strava' }, { $set: { lastSyncAt: startedAt } });
  return { connected: true, created, completed, enriched };
}

app.get('/api/strava', route(async (req, res) => {
  const link = await integrationsCol.findOne({ id: 'strava' });
  res.json({
    configured: stravaConfigured(),
    connected: !!link,
    athleteName: link ? link.athleteName : '',
    lastSyncAt: link ? link.lastSyncAt : null,
    instant: !!(link && link.webhookId)
  });
}));

// Réactive l'import instantané (si l'abonnement aux alertes Strava a échoué à la connexion)
app.post('/api/strava/webhook/setup', route(async (req, res) => {
  if (!stravaConfigured()) return res.status(503).json(NO_STRAVA);
  if (!await integrationsCol.findOne({ id: 'strava' })) return res.status(409).json({ error: 'Connecte d\'abord Strava' });
  try {
    await ensureStravaWebhook(publicOrigin(req));
    res.json({ instant: true });
  } catch (e) {
    reportError('strava', e);
    res.status(502).json({ error: 'Strava a refusé l\'abonnement aux alertes, réessaie plus tard' });
  }
}));

app.get('/api/strava/connect-url', (req, res) => {
  if (!stravaConfigured()) return res.status(503).json(NO_STRAVA);
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: `${publicOrigin(req)}/api/strava/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state: stravaState()
  });
  res.json({ url: `${STRAVA_URL}/oauth/authorize?${params}` });
});

let stravaSyncRunning = null;
app.post('/api/strava/sync', route(async (req, res) => {
  if (!stravaConfigured()) return res.json({ connected: false, configured: false });
  const link = await integrationsCol.findOne({ id: 'strava' });
  if (!link) return res.json({ connected: false, configured: true });
  const force = !!(req.body && req.body.force);
  if (!force && link.lastSyncAt && Date.now() - new Date(link.lastSyncAt).getTime() < STRAVA_SYNC_MIN_MS) {
    return res.json({ connected: true, skipped: true, created: 0, completed: 0 });
  }
  // Deux appareils qui s'ouvrent en même temps ne lancent qu'une synchronisation
  if (!stravaSyncRunning) stravaSyncRunning = syncStrava(link).finally(() => { stravaSyncRunning = null; });
  try {
    res.json(await stravaSyncRunning);
  } catch (e) {
    reportError('strava', e);
    res.status(502).json({ error: 'Strava ne répond pas pour le moment, réessaie plus tard' });
  }
}));

app.delete('/api/strava', route(async (req, res) => {
  const link = await integrationsCol.findOne({ id: 'strava' });
  if (link) {
    // Retire aussi l'accès côté Strava ; les courses déjà importées restent dans l'appli
    try {
      const token = await stravaAccessToken(link);
      if (token) await stravaFetch('/oauth/deauthorize', { method: 'POST', body: new URLSearchParams({ access_token: token }) });
      await removeStravaWebhook();
    } catch (e) {
      console.warn('Strava : retrait de l\'accès impossible', e.message);
    }
    await integrationsCol.deleteOne({ id: 'strava' });
  }
  res.json({ message: 'Strava déconnecté' });
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
module.exports.cleanEnvValue = cleanEnvValue;
module.exports.qstashTokenShape = qstashTokenShape;
