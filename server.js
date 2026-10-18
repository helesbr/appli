require('dotenv').config();
const express = require('express');
const path = require('path');

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

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
// On ne renvoie jamais le _id Mongo au client : l'appli utilise son propre champ "id"
const NO_ID = { projection: { _id: 0 } };

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
    // Le service worker, la page et son script doivent toujours être revalidés pour recevoir les mises à jour
    if (/(sw\.js|main\.js|index\.html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// --- AUTHENTIFICATION (mot de passe unique défini dans la variable APP_PASSWORD) ---
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
// Signé avec le mot de passe : le changer déconnecte tous les appareils
function signToken(payload) {
  return crypto.createHmac('sha256', 'moggtrack:' + APP_PASSWORD).update(payload).digest('base64url');
}
function createToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${signToken(exp)}`;
}
function isValidToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, signToken(exp));
}

const NO_PASSWORD = { error: 'Mot de passe non configuré : ajoute la variable APP_PASSWORD', code: 'NO_PASSWORD' };

app.post('/api/login', async (req, res) => {
  if (!APP_PASSWORD) return res.status(503).json(NO_PASSWORD);
  if (!safeEqual((req.body && req.body.password) || '', APP_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800)); // ralentit les essais en série
    return res.status(401).json({ error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' });
  }
  res.json({ token: createToken() });
});

app.use('/api', (req, res, next) => {
  if (!APP_PASSWORD) return res.status(503).json(NO_PASSWORD);
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!isValidToken(token)) return res.status(401).json({ error: 'Non autorisé', code: 'UNAUTHORIZED' });
  next();
});

let db, sessionsCol, templatesCol;

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
  await ensureIndexes();
  console.log('Connecté à MongoDB Atlas');
}

// Toutes les requêtes filtrent sur "id" ou sur "date" (plage de dates).
// Sans index, chacune parcourt toute la collection (COLLSCAN).
async function ensureIndexes() {
  const specs = [
    [sessionsCol, { id: 1 }, { unique: true, name: 'id_unique' }],
    [sessionsCol, { date: 1 }, { name: 'date_asc' }],
    [templatesCol, { id: 1 }, { unique: true, name: 'id_unique' }]
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

// Sur Vercel, une requête peut arriver avant la fin de la connexion
app.use('/api', async (req, res, next) => {
  try {
    await ensureMongo();
    next();
  } catch (e) {
    console.error('Erreur MongoDB:', e);
    res.status(500).json({
      error: 'Erreur MongoDB',
      detail: `${e.name}: ${String(e.message).slice(0, 200)}`
    });
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

// Reps / poids : "" = série pas encore faite. On garde le type envoyé (texte ou nombre)
function cleanAmount(v, max) {
  if (v === '' || v == null) return '';
  const n = parseFloat(v);
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
        rest: toInt(ex && ex.rest, 0, 3600, 0)
      }))
    }))
  }));
}

// Enveloppe les routes async : une seule gestion d'erreur au lieu d'un try/catch par route
const route = fn => (req, res, next) => fn(req, res).catch(next);

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

  const result = await sessionsCol.findOneAndUpdate(
    { id: req.params.id },
    { $set: update },
    { returnDocument: 'after', ...NO_ID }
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

  const result = await templatesCol.findOneAndUpdate(
    { id: req.params.id },
    { $set: update },
    { returnDocument: 'after', ...NO_ID }
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

// --- TOP PERFS ---
function flattenExercises(session) {
  const all = [];
  if (!session.blocks) return all;
  session.blocks.forEach(block => {
    (block.exercises || []).forEach(ex => all.push(ex));
  });
  return all;
}

app.get('/api/top-perfs', route(async (req, res) => {
  // Seuls les champs utiles au calcul sont lus
  const sessions = await sessionsCol
    .find({}, { projection: { _id: 0, id: 1, name: 1, date: 1, blocks: 1 } })
    .toArray();
  const perfs = {};
  sessions.forEach(session => {
    flattenExercises(session).forEach(ex => {
      const key = (ex.name || '').trim().toLowerCase();
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

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API inconnue' });
});

// Erreurs non prévues : JSON invalide (400), trop gros (413) ou erreur serveur (500)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps de requête JSON invalide' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur, réessaie dans un instant' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
  });
}

module.exports = app;
