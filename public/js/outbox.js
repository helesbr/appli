// Sauvegarde hors connexion : chaque modification est d'abord écrite sur le téléphone,
// puis envoyée au serveur dès que possible. Rien n'est perdu si le réseau coupe ou si l'appli se ferme.
const OUTBOX_KEY = 'moggtrack-outbox';
const RETRY_MS = 30000;
let outbox = readOutbox();
let outboxRev = outbox.reduce((max, i) => Math.max(max, i.rev || 0), 0);
let flushing = false;
let flushAgain = false;
let flushTimer = null;
// Téléphone « en ligne » mais réseau inutilisable : fréquent en salle
let syncBlocked = false;

function readOutbox() {
  try {
    const items = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch (e) { return []; }
}
function writeOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch (e) {
    toast('Mémoire du téléphone pleine : reconnecte-toi vite pour envoyer tes séries', 'error');
  }
}
function pendingCount() { return outbox.filter(i => !i.notBefore || i.notBefore <= Date.now()).length; }
function hasPending(kind, id) { return outbox.some(i => i.kind === kind && i.id === id); }

function refreshLocal(kind) {
  if (kind === 'sessions') {
    sessions = applyOutbox(sessions, outbox, 'sessions');
    if (!workout) renderWeek();
  } else {
    templates = applyOutbox(templates, outbox, 'templates');
    renderTemplates();
  }
  refreshExerciseSuggestions();
}
function updateSyncUI() {
  const pill = document.getElementById('syncPill');
  const count = pendingCount();
  pill.hidden = count === 0;
  pill.querySelector('span').textContent = `${count} à envoyer`;
  if (workout) {
    if (!hasPending('sessions', workout.id)) setWkStatus('Enregistré ✓');
    else setWkStatus(navigator.onLine && !syncBlocked ? 'Enregistrement…' : 'Gardé sur le téléphone');
  }
}

function enqueue(item, flushDelay) {
  outbox = upsertOutboxItem(outbox, { ...item, rev: ++outboxRev });
  writeOutbox();
  refreshLocal(item.kind);
  updateSyncUI();
  scheduleFlush(flushDelay);
}
function saveRecord(kind, id, data, options = {}) {
  enqueue({ kind, id, op: 'save', data, notBefore: 0 }, options.flushDelay || 0);
}
// Suppression différée pour laisser le temps d'annuler, même si l'appli se ferme entre-temps.
// Renvoie la fonction d'annulation.
function deleteRecord(kind, id, undoMs = 0) {
  const list = kind === 'sessions' ? sessions : templates;
  const snapshot = list.find(r => r.id === id);
  const previous = outbox.find(i => i.kind === kind && i.id === id) || null;
  enqueue({ kind, id, op: 'delete', notBefore: undoMs ? Date.now() + undoMs : 0 }, undoMs ? undoMs + 100 : 0);
  return () => {
    outbox = outbox.filter(i => !(i.kind === kind && i.id === id));
    if (previous) outbox.push(previous);
    writeOutbox();
    if (snapshot) {
      if (kind === 'sessions') sessions = [...sessions, snapshot];
      else templates = [...templates, snapshot];
    }
    refreshLocal(kind);
    updateSyncUI();
  };
}

function scheduleFlush(delay = 0) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushOutbox(), delay);
}
function sendItem(item) {
  const url = `/api/${item.kind}/${item.id}`;
  if (item.op === 'delete') return api(url, { method: 'DELETE' });
  const body = item.data;
  // keepalive : l'envoi aboutit même si l'appli passe en arrière-plan, mais il est limité à 64 ko
  return api(url, { method: 'PUT', body, keepalive: JSON.stringify(body).length < 60000 });
}
async function flushOutbox() {
  if (flushing) { flushAgain = true; return; }
  if (!getToken()) return;
  flushing = true;
  let sent = false;
  let blocked = false;
  try {
    for (;;) {
      const item = dueOutboxItems(outbox, Date.now())[0];
      if (!item) break;
      try {
        await sendItem(item);
        sent = true;
      } catch (e) {
        // Déjà supprimée ailleurs : le résultat voulu est atteint
        const alreadyGone = item.op === 'delete' && e.status === 404;
        if (!alreadyGone && (e.network || e.silent || !e.status || e.status >= 500)) { blocked = true; break; }
        if (!alreadyGone) toast(`Modification refusée par le serveur : ${e.message}`, 'error');
      }
      outbox = removeOutboxItem(outbox, item);
      writeOutbox();
      updateSyncUI();
    }
  } finally {
    flushing = false;
  }
  syncBlocked = blocked;
  updateSyncUI();
  if (flushAgain) { flushAgain = false; scheduleFlush(); return; }
  if (sent) quiet(loadSessions());
  if (blocked) scheduleFlush(RETRY_MS);
  else {
    const waiting = outbox.filter(i => i.notBefore > Date.now()).map(i => i.notBefore);
    if (waiting.length) scheduleFlush(Math.min(...waiting) - Date.now() + 100);
  }
}

document.getElementById('syncPill').onclick = () => {
  if (navigator.onLine) flushOutbox();
  else toast('Hors connexion : l\'envoi se fera au retour du réseau');
};
// Dernière chance d'envoyer avant que le téléphone ne mette l'appli en pause
document.addEventListener('visibilitychange', () => { if (document.hidden && outbox.length) flushOutbox(); });
