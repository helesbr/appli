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
  return { tasks: [], sessions: [] };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let data = loadData();
// Migration: ancien format (tableau) -> nouveau format (objet)
if (Array.isArray(data)) {
  data = { tasks: data, sessions: [] };
  saveData(data);
}

// --- TASKS API (existant) ---
app.get('/api/tasks', (req, res) => {
  res.json(data.tasks);
});

app.post('/api/tasks', (req, res) => {
  const { task } = req.body;
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'Tâche invalide' });
  }
  const sanitized = task.trim().slice(0, 500);
  data.tasks.push(sanitized);
  saveData(data);
  res.status(201).json({ message: `"${sanitized}" ajoutée !`, tasks: data.tasks });
});

app.delete('/api/tasks/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= data.tasks.length) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  const removed = data.tasks.splice(index, 1);
  saveData(data);
  res.json({ message: `"${removed[0]}" supprimée !`, tasks: data.tasks });
});

// --- SESSIONS API ---
// Récupérer toutes les séances
app.get('/api/sessions', (req, res) => {
  res.json(data.sessions);
});

// Récupérer une séance par ID
app.get('/api/sessions/:id', (req, res) => {
  const session = data.sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Séance introuvable' });
  res.json(session);
});

// Créer une séance
app.post('/api/sessions', (req, res) => {
  const { date, name, exercises } = req.body;
  if (!date || !name || !Array.isArray(exercises)) {
    return res.status(400).json({ error: 'Données invalides' });
  }
  const session = {
    id: crypto.randomUUID(),
    date: date.slice(0, 10),
    name: name.trim().slice(0, 200),
    exercises: exercises.map(ex => ({
      name: (ex.name || '').trim().slice(0, 200),
      sets: (ex.sets || []).map(s => ({
        reps: Math.max(0, Math.min(9999, parseInt(s.reps) || 0)),
        weight: Math.max(0, Math.min(9999, parseFloat(s.weight) || 0))
      }))
    }))
  };
  data.sessions.push(session);
  saveData(data);
  res.status(201).json(session);
});

// Modifier une séance
app.put('/api/sessions/:id', (req, res) => {
  const idx = data.sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Séance introuvable' });
  const { date, name, exercises } = req.body;
  if (date) data.sessions[idx].date = date.slice(0, 10);
  if (name) data.sessions[idx].name = name.trim().slice(0, 200);
  if (Array.isArray(exercises)) {
    data.sessions[idx].exercises = exercises.map(ex => ({
      name: (ex.name || '').trim().slice(0, 200),
      sets: (ex.sets || []).map(s => ({
        reps: Math.max(0, Math.min(9999, parseInt(s.reps) || 0)),
        weight: Math.max(0, Math.min(9999, parseFloat(s.weight) || 0))
      }))
    }));
  }
  saveData(data);
  res.json(data.sessions[idx]);
});

// Supprimer une séance
app.delete('/api/sessions/:id', (req, res) => {
  const idx = data.sessions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Séance introuvable' });
  const removed = data.sessions.splice(idx, 1);
  saveData(data);
  res.json({ message: 'Séance supprimée', session: removed[0] });
});

// --- TOP PERFS API ---
app.get('/api/top-perfs', (req, res) => {
  const perfs = {};
  data.sessions.forEach(session => {
    session.exercises.forEach(ex => {
      const key = ex.name.toLowerCase();
      ex.sets.forEach(set => {
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
