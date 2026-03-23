const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Charger les tâches depuis le fichier
function loadTasks() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Erreur lecture data.json:', e.message);
  }
  return [];
}

// Sauvegarder les tâches dans le fichier
function saveTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

let tasks = loadTasks();

// Récupérer toutes les tâches
app.get('/api/tasks', (req, res) => {
  res.json(tasks);
});

// Ajouter une tâche
app.post('/api/tasks', (req, res) => {
  const { task } = req.body;
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'Tâche invalide' });
  }
  const sanitized = task.trim().slice(0, 500);
  tasks.push(sanitized);
  saveTasks(tasks);
  res.status(201).json({ message: `"${sanitized}" ajoutée !`, tasks });
});

// Supprimer une tâche
app.delete('/api/tasks/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= tasks.length) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }
  const removed = tasks.splice(index, 1);
  saveTasks(tasks);
  res.json({ message: `"${removed[0]}" supprimée !`, tasks });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
