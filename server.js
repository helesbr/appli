require('dotenv').config();
const express = require('express');
const path = require('path');

const { MongoClient, ObjectId } = require('mongodb');
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Le service worker et la page doivent toujours être revalidés pour recevoir les mises à jour
    if (/(sw\.js|index\.html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
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

let db, sessionsCol, templatesCol, tasksCol;

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
  tasksCol = db.collection('tasks');
  console.log('Connecté à MongoDB Atlas');
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

ensureMongo().catch(e => {
  console.error('Erreur MongoDB:', e);
  if (!process.env.VERCEL) process.exit(1);
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

// --- Appliquer un template à une semaine (MongoDB) ---
app.post('/api/templates/:id/apply', async (req, res) => {
  try {
    const tpl = await templatesCol.findOne({ id: req.params.id });
    if (!tpl) return res.status(404).json({ error: 'Template introuvable' });
    const { weekStart } = req.body; // "2026-03-23" (lundi)
    if (!weekStart) return res.status(400).json({ error: 'weekStart requis' });
    const created = [];
    for (const tplSession of tpl.sessions) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + (tplSession.dayOfWeek - 1));
      const dateStr = d.toISOString().slice(0, 10);
      const session = {
        id: crypto.randomUUID(),
        date: dateStr,
        name: tplSession.name,
        blocks: tplSession.blocks.map(b => ({
          type: b.type,
          exercises: b.exercises.map(ex => ({
            name: ex.name,
            rest: ex.rest || 0,
            // Séries planifiées : objectif de reps, charges à remplir à la salle
            sets: Array.from({ length: ex.setsCount }, () => ({ reps: '', weight: '', target: ex.reps || '' }))
          }))
        }))
      };
      await sessionsCol.insertOne(session);
      created.push(session);
    }
    res.status(201).json({ message: `${created.length} séances créées`, sessions: created });
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- Utilitaire pour extraire tous les exercices d'une séance (pour top-perfs) ---
function flattenExercises(session) {
  const all = [];
  if (!session.blocks) return all;
  session.blocks.forEach(block => {
    (block.exercises || []).forEach(ex => {
      all.push(ex);
    });
  });
  return all;
}

// --- TOP PERFS API (MongoDB) ---
app.get('/api/top-perfs', async (req, res) => {
  try {
    const sessions = await sessionsCol.find({}).toArray();
    const perfs = {};
    sessions.forEach(session => {
      const exercises = flattenExercises(session);
      exercises.forEach(ex => {
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
    res.json(Object.values(perfs).sort((a, b) => a.exercise.localeCompare(b.exercise)));
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


// --- Supprimer une séance (MongoDB) ---
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const result = await sessionsCol.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Séance introuvable' });
    res.json({ message: 'Séance supprimée' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


// (Déjà présent plus haut: version MongoDB)


app.post('/api/templates', async (req, res) => {
  const { name, weekType, sessions: tplSessions } = req.body;
  if (!name || !Array.isArray(tplSessions))
    return res.status(400).json({ error: 'Données invalides' });
  const tpl = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 200),
    weekType: (weekType || '').trim().slice(0, 100),
    sessions: tplSessions.map(s => ({
      name: (s.name || '').trim().slice(0, 200),
      dayOfWeek: Math.max(1, Math.min(7, parseInt(s.dayOfWeek) || 1)),
      blocks: (s.blocks || []).map(b => ({
        type: b.type === 'superset' ? 'superset' : 'single',
        exercises: (b.exercises || []).map(ex => ({
          name: (ex.name || '').trim().slice(0, 200),
          setsCount: Math.max(1, Math.min(20, parseInt(ex.setsCount) || 4)),
          reps: String(ex.reps ?? '').trim().slice(0, 20),
          rest: Math.max(0, Math.min(3600, parseInt(ex.rest) || 0))
        }))
      }))
    }))
  };
  try {
    await templatesCol.insertOne(tpl);
    res.status(201).json(tpl);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


app.put('/api/templates/:id', async (req, res) => {
  const { name, weekType, sessions: tplSessions } = req.body;
  const update = {};
  if (name) update.name = name.trim().slice(0, 200);
  if (weekType !== undefined) update.weekType = (weekType || '').trim().slice(0, 100);
  if (Array.isArray(tplSessions)) {
    update.sessions = tplSessions.map(s => ({
      name: (s.name || '').trim().slice(0, 200),
      dayOfWeek: Math.max(1, Math.min(7, parseInt(s.dayOfWeek) || 1)),
      blocks: (s.blocks || []).map(b => ({
        type: b.type === 'superset' ? 'superset' : 'single',
        exercises: (b.exercises || []).map(ex => ({
          name: (ex.name || '').trim().slice(0, 200),
          setsCount: Math.max(1, Math.min(20, parseInt(ex.setsCount) || 4)),
          reps: String(ex.reps ?? '').trim().slice(0, 20),
          rest: Math.max(0, Math.min(3600, parseInt(ex.rest) || 0))
        }))
      }))
    }));
  }
  try {
    const result = await templatesCol.findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Template introuvable' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});


app.delete('/api/templates/:id', async (req, res) => {
  try {
    const result = await templatesCol.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Template introuvable' });
    res.json({ message: 'Template supprimé' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- GET toutes les séances ---
app.get('/api/sessions', async (req, res) => {
  try {
    const result = await sessionsCol.find({}).toArray();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- GET une séance par id ---
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await sessionsCol.findOne({ id: req.params.id });
    if (!session) return res.status(404).json({ error: 'Séance introuvable' });
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- POST créer une séance ---
app.post('/api/sessions', async (req, res) => {
  try {
    const { date, name, blocks } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'date et name requis' });
    const session = { id: crypto.randomUUID(), date, name, blocks: blocks || [] };
    await sessionsCol.insertOne(session);
    res.status(201).json(session);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- PUT modifier une séance ---
app.put('/api/sessions/:id', async (req, res) => {
  try {
    const { date, name, blocks, completed } = req.body;
    const update = { date, name, blocks };
    if (typeof completed === 'boolean') update.completed = completed;
    const result = await sessionsCol.findOneAndUpdate(
      { id: req.params.id },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Séance introuvable' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});

// --- GET tous les templates ---
app.get('/api/templates', async (req, res) => {
  try {
    const result = await templatesCol.find({}).toArray();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur MongoDB' });
  }
});
// (Déjà présent plus haut: version MongoDB)

// --- TOP PERFS API ---

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
  });
}

module.exports = app;
