const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Persistence ---
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Erreur lecture data.json:', e.message);
  }
  return { tasks: [], sessions: [], templates: [] };
}

function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf-8');
}

let data = loadData();
// Migration
if (Array.isArray(data)) {
  data = { tasks: data, sessions: [], templates: [] };
  saveData(data);
}
if (!data.templates) { data.templates = []; saveData(data); }

// Migration: sessions avec exercises -> blocks
data.sessions.forEach(s => {
  if (s.exercises && !s.blocks) {
    s.blocks = s.exercises.map(ex => ({ type: 'single', exercises: [ex] }));
    delete s.exercises;
  }
});
saveData(data);

// Helper: sanitize block
function sanitizeBlocks(blocks) {
  return (blocks || []).map(b => ({
    type: b.type === 'superset' ? 'superset' : 'single',
    exercises: (b.exercises || []).map(ex => ({
      name: (ex.name || '').trim().slice(0, 200),
      sets: (ex.sets || []).map(s => ({
        reps: Math.max(0, Math.min(9999, parseInt(s.reps) || 0)),
        weight: Math.max(0, Math.min(9999, parseFloat(s.weight) || 0))
      }))
    }))
  }));
}

// Helper: flatten blocks to exercises (for top perfs)
function flattenExercises(session) {
  if (session.blocks) {
    return session.blocks.flatMap(b => b.exercises || []);
  }
  return session.exercises || [];
}

// --- TASKS API ---
app.get('/api/tasks', (req, res) => res.json(data.tasks));

app.post('/api/tasks', (req, res) => {
  const { task } = req.body;
  if (!task || typeof task !== 'string' || task.trim().length === 0)
    return res.status(400).json({ error: 'Tâche invalide' });
  const sanitized = task.trim().slice(0, 500);
  data.tasks.push(sanitized);
  saveData(data);
  res.status(201).json({ message: `"${sanitized}" ajoutée !`, tasks: data.tasks });
});

app.delete('/api/tasks/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= data.tasks.length)
    return res.status(400).json({ error: 'Numéro invalide' });
  const removed = data.tasks.splice(index, 1);
  saveData(data);
  res.json({ message: `"${removed[0]}" supprimée !`, tasks: data.tasks });
});

// --- SESSIONS API ---
app.get('/api/sessions', (req, res) => res.json(data.sessions));

app.get('/api/sessions/:id', (req, res) => {
  const session = data.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });
  res.json(session);
});

app.post('/api/sessions', (req, res) => {
  const { date, name, blocks } = req.body;
  if (!date || !name || !Array.isArray(blocks))
    return res.status(400).json({ error: 'Données invalides' });
  const session = {
    id: crypto.randomUUID(),
    date: date.slice(0, 10),
    name: name.trim().slice(0, 200),
    blocks: sanitizeBlocks(blocks)
  };
  data.sessions.push(session);
  saveData(data);
  res.status(201).json(session);
});

app.put('/api/sessions/:id', (req, res) => {
  const idx = data.sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Séance introuvable' });
  const { date, name, blocks } = req.body;
  if (date) data.sessions[idx].date = date.slice(0, 10);
  if (name) data.sessions[idx].name = name.trim().slice(0, 200);
  if (Array.isArray(blocks)) data.sessions[idx].blocks = sanitizeBlocks(blocks);
  saveData(data);
  res.json(data.sessions[idx]);
});

app.delete('/api/sessions/:id', (req, res) => {
  const idx = data.sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Séance introuvable' });
  const removed = data.sessions.splice(idx, 1);
  saveData(data);
  res.json({ message: 'Séance supprimée', session: removed[0] });
});

// --- TEMPLATES API ---
// Template: { id, name, weekType, sessions: [{ name, dayOfWeek (1=Lun..7=Dim), blocks: [{ type, exercises: [{ name, setsCount }] }] }] }
app.get('/api/templates', (req, res) => res.json(data.templates));

app.get('/api/templates/:id', (req, res) => {
  const t = data.templates.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Template introuvable' });
  res.json(t);
});

app.post('/api/templates', (req, res) => {
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
          setsCount: Math.max(1, Math.min(20, parseInt(ex.setsCount) || 4))
        }))
      }))
    }))
  };
  data.templates.push(tpl);
  saveData(data);
  res.status(201).json(tpl);
});

app.put('/api/templates/:id', (req, res) => {
  const idx = data.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template introuvable' });
  const { name, weekType, sessions: tplSessions } = req.body;
  if (name) data.templates[idx].name = name.trim().slice(0, 200);
  if (weekType !== undefined) data.templates[idx].weekType = (weekType || '').trim().slice(0, 100);
  if (Array.isArray(tplSessions)) {
    data.templates[idx].sessions = tplSessions.map(s => ({
      name: (s.name || '').trim().slice(0, 200),
      dayOfWeek: Math.max(1, Math.min(7, parseInt(s.dayOfWeek) || 1)),
      blocks: (s.blocks || []).map(b => ({
        type: b.type === 'superset' ? 'superset' : 'single',
        exercises: (b.exercises || []).map(ex => ({
          name: (ex.name || '').trim().slice(0, 200),
          setsCount: Math.max(1, Math.min(20, parseInt(ex.setsCount) || 4))
        }))
      }))
    }));
  }
  saveData(data);
  res.json(data.templates[idx]);
});

app.delete('/api/templates/:id', (req, res) => {
  const idx = data.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template introuvable' });
  data.templates.splice(idx, 1);
  saveData(data);
  res.json({ message: 'Template supprimé' });
});

// Appliquer un template à une semaine
app.post('/api/templates/:id/apply', (req, res) => {
  const tpl = data.templates.find(t => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template introuvable' });
  const { weekStart } = req.body; // "2026-03-23" (lundi)
  if (!weekStart) return res.status(400).json({ error: 'weekStart requis' });

  const created = [];
  tpl.sessions.forEach(tplSession => {
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
          sets: Array.from({ length: ex.setsCount }, () => ({ reps: 0, weight: 0 }))
        }))
      }))
    };
    data.sessions.push(session);
    created.push(session);
  });
  saveData(data);
  res.status(201).json({ message: `${created.length} séances créées`, sessions: created });
});

// --- TOP PERFS API ---
app.get('/api/top-perfs', (req, res) => {
  const perfs = {};
  data.sessions.forEach(session => {
    const exercises = flattenExercises(session);
    exercises.forEach(ex => {
      const key = ex.name.toLowerCase();
      (ex.sets || []).forEach(set => {
        if (!perfs[key] || set.weight > perfs[key].weight ||
           (set.weight === perfs[key].weight && set.reps > perfs[key].reps)) {
          perfs[key] = {
            exercise: ex.name,
            weight: set.weight,
            reps: set.reps,
            sessionId: session.id,
            sessionName: session.name,
            date: session.date
          };
        }
      });
    });
  });
  res.json(Object.values(perfs).sort((a, b) => a.exercise.localeCompare(b.exercise)));
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
