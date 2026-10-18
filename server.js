require('dotenv').config();
const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DBNAME = process.env.MONGODB_DBNAME || 'moggtrack';

if (!MONGODB_URI) {
  console.error('MONGODB_URI manquant dans le fichier .env');
  process.exit(1);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// On ne renvoie jamais le _id Mongo au client : l'appli utilise son propre champ "id"
const NO_ID = { projection: { _id: 0 } };

app.disable('x-powered-by');

// En-têtes de sécurité (sans dépendance supplémentaire)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
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
app.use(express.static(path.join(__dirname, 'public')));

let db, sessionsCol, templatesCol;
let ready;

async function connectMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DBNAME);
  sessionsCol = db.collection('sessions');
  templatesCol = db.collection('templates');
  await ensureIndexes();
  console.log('✅ Connecté à MongoDB Atlas');
}

// Toutes les requêtes filtrent sur "id" ou sur "date" (tri + plage de la semaine).
// Sans index, chacune fait un COLLSCAN de toute la collection.
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
      console.warn(`⚠️ Index ${col.collectionName}.${opts.name} non créé :`, e.message);
    }
  }
}

function toInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toFloat(v, min, max, fallback) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanText(v, max) {
  return (v || '').toString().trim().slice(0, max);
}

function flattenExercises(session) {
  const all = [];
  if (!session.blocks) return all;
  session.blocks.forEach(block => {
    (block.exercises || []).forEach(ex => all.push(ex));
  });
  return all;
}

function sanitizeSessionBody(body) {
  const date = cleanText(body.date, 10);
  const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 50) : [];

  return {
    date: DATE_RE.test(date) ? date : '',
    name: cleanText(body.name, 200),
    blocks: blocks.map(b => ({
      type: b.type === 'superset' ? 'superset' : 'single',
      exercises: Array.isArray(b.exercises) ? b.exercises.slice(0, 20).map(ex => ({
        name: cleanText(ex.name, 200),
        rest: toInt(ex.rest, 0, 3600, 0),
        sets: Array.isArray(ex.sets) ? ex.sets.slice(0, 50).map(set => ({
          reps: toInt(set.reps, 0, 9999, 0),
          weight: toFloat(set.weight, 0, 9999, 0)
        })) : []
      })).filter(ex => ex.name) : []
    })).filter(b => b.exercises.length > 0)
  };
}

function sanitizeTemplateBody(body) {
  const tplSessions = Array.isArray(body.sessions) ? body.sessions.slice(0, 21) : [];

  return {
    name: cleanText(body.name, 200),
    weekType: cleanText(body.weekType, 100),
    sessions: tplSessions.map(s => ({
      name: cleanText(s.name, 200),
      dayOfWeek: toInt(s.dayOfWeek, 1, 7, 1),
      blocks: Array.isArray(s.blocks) ? s.blocks.slice(0, 50).map(b => ({
        type: b.type === 'superset' ? 'superset' : 'single',
        exercises: Array.isArray(b.exercises) ? b.exercises.slice(0, 20).map(ex => ({
          name: cleanText(ex.name, 200),
          setsCount: toInt(ex.setsCount, 1, 20, 4),
          rest: toInt(ex.rest, 0, 3600, 0)
        })).filter(ex => ex.name) : []
      })).filter(b => b.exercises.length > 0) : []
    })).filter(s => s.name)
  };
}

// Garantit la connexion avant chaque appel API (utile aussi en serverless sur Vercel)
app.use('/api', async (req, res, next) => {
  try {
    await ready;
    next();
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: 'Base de données indisponible, réessaie dans un instant.' });
  }
});

// Enveloppe les routes async : une seule gestion d'erreur au lieu d'un try/catch par route
const route = fn => (req, res, next) => fn(req, res).catch(next);

app.get('/api/sessions', route(async (req, res) => {
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD pour ne charger que la semaine affichée
  const filter = {};
  const { from, to } = req.query;
  if (DATE_RE.test(from || '') || DATE_RE.test(to || '')) {
    filter.date = {};
    if (DATE_RE.test(from || '')) filter.date.$gte = from;
    if (DATE_RE.test(to || '')) filter.date.$lte = to;
  }
  const result = await sessionsCol.find(filter, NO_ID).sort({ date: 1 }).toArray();
  res.json(result);
}));

app.get('/api/sessions/:id', route(async (req, res) => {
  const session = await sessionsCol.findOne({ id: req.params.id }, NO_ID);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });
  res.json(session);
}));

app.post('/api/sessions', route(async (req, res) => {
  const data = sanitizeSessionBody(req.body || {});
  if (!data.date || !data.name) {
    return res.status(400).json({ error: 'Indique une date valide et un nom de séance.' });
  }

  const session = { id: crypto.randomUUID(), ...data };
  await sessionsCol.insertOne({ ...session });
  res.status(201).json(session);
}));

app.put('/api/sessions/:id', route(async (req, res) => {
  const data = sanitizeSessionBody(req.body || {});
  if (!data.date || !data.name) {
    return res.status(400).json({ error: 'Indique une date valide et un nom de séance.' });
  }

  const updated = await sessionsCol.findOneAndUpdate(
    { id: req.params.id },
    { $set: data },
    { returnDocument: 'after', ...NO_ID }
  );
  if (!updated) return res.status(404).json({ error: 'Séance introuvable' });
  res.json(updated);
}));

app.delete('/api/sessions/:id', route(async (req, res) => {
  const result = await sessionsCol.deleteOne({ id: req.params.id });
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Séance introuvable' });
  }
  res.json({ message: 'Séance supprimée' });
}));

app.get('/api/templates', route(async (req, res) => {
  const result = await templatesCol.find({}, NO_ID).sort({ name: 1 }).toArray();
  res.json(result);
}));

app.post('/api/templates', route(async (req, res) => {
  const data = sanitizeTemplateBody(req.body || {});
  if (!data.name) {
    return res.status(400).json({ error: 'Donne un nom au template.' });
  }

  const tpl = { id: crypto.randomUUID(), ...data };
  await templatesCol.insertOne({ ...tpl });
  res.status(201).json(tpl);
}));

app.put('/api/templates/:id', route(async (req, res) => {
  const data = sanitizeTemplateBody(req.body || {});
  if (!data.name) {
    return res.status(400).json({ error: 'Donne un nom au template.' });
  }

  const updated = await templatesCol.findOneAndUpdate(
    { id: req.params.id },
    { $set: data },
    { returnDocument: 'after', ...NO_ID }
  );
  if (!updated) return res.status(404).json({ error: 'Template introuvable' });
  res.json(updated);
}));

app.delete('/api/templates/:id', route(async (req, res) => {
  const result = await templatesCol.deleteOne({ id: req.params.id });
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Template introuvable' });
  }
  res.json({ message: 'Template supprimé' });
}));

app.post('/api/templates/:id/apply', route(async (req, res) => {
  const tpl = await templatesCol.findOne({ id: req.params.id }, NO_ID);
  if (!tpl) return res.status(404).json({ error: 'Template introuvable' });

  const weekStart = cleanText((req.body || {}).weekStart, 10);
  if (!DATE_RE.test(weekStart)) {
    return res.status(400).json({ error: 'weekStart doit être au format AAAA-MM-JJ' });
  }

  // Calcul en UTC : "new Date('AAAA-MM-JJ')" est minuit UTC, getDate() local décalerait d'un jour
  const created = (tpl.sessions || []).map(tplSession => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + (tplSession.dayOfWeek - 1));

    return {
      id: crypto.randomUUID(),
      date: d.toISOString().slice(0, 10),
      name: tplSession.name,
      blocks: (tplSession.blocks || []).map(b => ({
        type: b.type,
        exercises: (b.exercises || []).map(ex => ({
          name: ex.name,
          rest: ex.rest || 0,
          sets: Array.from({ length: ex.setsCount || 4 }, () => ({ reps: 0, weight: 0 }))
        }))
      }))
    };
  });

  if (created.length > 0) {
    await sessionsCol.insertMany(created.map(s => ({ ...s })));
  }

  res.status(201).json({
    message: `${created.length} séances créées`,
    sessions: created
  });
}));

app.get('/api/top-perfs', route(async (req, res) => {
  // Seuls les champs utiles au calcul sont lus
  const sessions = await sessionsCol
    .find({}, { projection: { _id: 0, id: 1, name: 1, date: 1, blocks: 1 } })
    .toArray();
  const perfs = {};

  sessions.forEach(session => {
    flattenExercises(session).forEach(ex => {
      if (!ex.name) return;
      const key = ex.name.trim().toLowerCase();

      (ex.sets || []).forEach(set => {
        const weight = Number(set.weight) || 0;
        const reps = Number(set.reps) || 0;
        if (weight === 0 && reps === 0) return;

        if (
          !perfs[key] ||
          weight > perfs[key].weight ||
          (weight === perfs[key].weight && reps > perfs[key].reps)
        ) {
          perfs[key] = {
            exercise: ex.name,
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

  res.json(
    Object.values(perfs).sort((a, b) => a.exercise.localeCompare(b.exercise, 'fr'))
  );
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API inconnue' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Erreurs non prévues : JSON invalide (400) ou erreur serveur (500), sans détail interne
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps de requête JSON invalide' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Requête trop volumineuse' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur, réessaie dans un instant.' });
});

ready = connectMongo();
ready.catch(e => {
  console.error('❌ Erreur MongoDB :', e);
  if (require.main === module) process.exit(1);
});

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
