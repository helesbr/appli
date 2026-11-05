// Fonctions pures, sans accès à la page : testées dans test/logic.test.js
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const DAYS_SHORT = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const DAYS_LETTER = ['L','M','M','J','V','S','D'];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0,0,0,0);
  return date;
}
function getWeekNumber(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}
function formatDate(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function frDate(str) { const [y,m,d]=str.split('-'); return `${d}/${m}/${y}`; }
function frLongDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function frDay(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
}
function frDateRange(start) {
  const end = new Date(start); end.setDate(end.getDate()+6);
  const opts = { day:'numeric', month:'short' };
  return `${start.toLocaleDateString('fr-FR',opts)} — ${end.toLocaleDateString('fr-FR',opts)} ${end.getFullYear()}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
const blankZero = v => (v === '' || v == null || Number(v) === 0) ? '' : v;

function sessionStats(s) {
  let exos = 0, sets = 0, volume = 0;
  (s.blocks||[]).forEach(b => (b.exercises||[]).forEach(ex => {
    exos++;
    (ex.sets||[]).forEach(set => { sets++; volume += num(set.reps) * num(set.weight); });
  }));
  return { exos, sets, volume };
}
// Une séance passée non terminée est « manquée », même si elle reste lançable
function sessionStatus(s, today) {
  if (s.completed) return 'done';
  return s.date < today ? 'missed' : 'planned';
}

// Poids : toujours avec un point (règle anglaise), même si le clavier propose une virgule
function normalizeWeight(v) {
  return String(v ?? '').trim().replace(',', '.').replace(/\.$/, '');
}
// Pendant la saisie : la virgule devient un point ; chiffres et un seul point uniquement
function cleanWeightTyping(v) {
  const kept = v.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const sep = kept.indexOf('.');
  if (sep < 0) return kept;
  return kept.slice(0, sep + 1) + kept.slice(sep + 1).replace(/\./g, '');
}
// Boutons +2.5 / -2.5 : champ vide = on part de la charge de la dernière fois
function stepWeight(current, fallback, delta) {
  const base = String(current ?? '').trim() !== '' ? num(current) : num(fallback);
  const next = Math.max(0, Math.round((base + delta) * 100) / 100);
  return next === 0 ? '' : String(next);
}

// Même exercice malgré la casse, les accents ou les espaces : « Développé  couché » = « developpe couche »
function exerciseKey(name) {
  return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
// Noms déjà utilisés (les plus fréquents d'abord), avec l'orthographe la plus courante
function buildExerciseNames(sessions, templates) {
  const counts = new Map();
  const add = name => {
    const key = exerciseKey(name);
    if (!key) return;
    const entry = counts.get(key) || { total: 0, spellings: new Map() };
    const spelling = String(name).trim().replace(/\s+/g, ' ');
    entry.total++;
    entry.spellings.set(spelling, (entry.spellings.get(spelling) || 0) + 1);
    counts.set(key, entry);
  };
  (sessions || []).forEach(s => (s.blocks || []).forEach(b => (b.exercises || []).forEach(ex => add(ex.name))));
  (templates || []).forEach(t => (t.sessions || []).forEach(s => (s.blocks || []).forEach(b => (b.exercises || []).forEach(ex => add(ex.name)))));
  return [...counts.values()]
    .sort((a, b) => b.total - a.total)
    .map(entry => [...entry.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
function canonicalExerciseName(name, names) {
  const key = exerciseKey(name);
  if (!key) return String(name ?? '').trim();
  return names.find(n => exerciseKey(n) === key) || String(name).trim();
}

// Déplace un exercice dans son bloc, sinon échange le bloc avec son voisin (un superset bouge d'un seul tenant).
// Renvoie sa nouvelle position, ou null s'il est déjà au bout.
function moveExercise(blocks, bi, ei, dir) {
  const block = blocks[bi];
  if (!block) return null;
  const target = ei + dir;
  if (target >= 0 && target < block.exercises.length) {
    [block.exercises[ei], block.exercises[target]] = [block.exercises[target], block.exercises[ei]];
    return { bi, ei: target };
  }
  const neighbor = bi + dir;
  if (neighbor < 0 || neighbor >= blocks.length) return null;
  [blocks[bi], blocks[neighbor]] = [blocks[neighbor], blocks[bi]];
  return { bi: neighbor, ei };
}

// --- FILE D'ATTENTE DES MODIFICATIONS ---
// Une seule entrée par fiche : la dernière version remplace les précédentes
function upsertOutboxItem(items, item) {
  return [...items.filter(i => !(i.kind === item.kind && i.id === item.id)), item];
}
function removeOutboxItem(items, item) {
  // Si la fiche a été remodifiée pendant l'envoi, la nouvelle version reste à envoyer
  return items.filter(i => !(i.kind === item.kind && i.id === item.id && i.rev === item.rev));
}
function dueOutboxItems(items, now) {
  return items.filter(i => !i.notBefore || i.notBefore <= now);
}
// Applique les modifications pas encore envoyées sur les données connues
function applyOutbox(list, items, kind) {
  let result = list.slice();
  items.filter(i => i.kind === kind).forEach(item => {
    const index = result.findIndex(r => r.id === item.id);
    if (item.op === 'delete') {
      if (index >= 0) result.splice(index, 1);
    } else if (index >= 0) {
      result[index] = { ...result[index], ...item.data, id: item.id };
    } else {
      result.push({ ...item.data, id: item.id });
    }
  });
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = {
    getMonday, getWeekNumber, formatDate, frDate, escapeHtml, num, blankZero, sessionStats, sessionStatus,
    normalizeWeight, cleanWeightTyping, stepWeight, exerciseKey, buildExerciseNames, canonicalExerciseName,
    moveExercise, upsertOutboxItem, removeOutboxItem, dueOutboxItems, applyOutbox
  };
}
