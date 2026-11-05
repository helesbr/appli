// État partagé, appels au serveur, messages et fenêtres
let sessions = [];
let templates = [];
let perfs = [];
let currentWeekStart = getMonday(new Date());
let editingSessionId = null;
let editingTplId = null;
const UNDO_MS = 6000; // durée pendant laquelle « Annuler » reste proposé

const TOKEN_KEY = 'moggtrack-token';
function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

async function api(url, opts = {}) {
  const headers = { 'Authorization': 'Bearer ' + (getToken() || '') };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method: opts.method || 'GET', headers, keepalive: !!opts.keepalive, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    const err = new Error('Pas de connexion : réessaie quand tu seras en ligne');
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.code === 'NO_PASSWORD') {
    showLogin(data.code === 'NO_PASSWORD' ? data.error : 'Session expirée, reconnecte-toi');
    const err = new Error(data.error || 'Non autorisé');
    err.silent = true;
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Erreur serveur');
    err.status = res.status;
    throw err;
  }
  return data;
}
// Les erreurs des actions (sauvegarde, suppression…) s'affichent en toast
window.addEventListener('unhandledrejection', e => {
  if (e.reason && e.reason.silent) return;
  toast((e.reason && e.reason.message) || 'Une erreur est survenue', 'error');
});
// Chargements en arrière-plan : pas de message si le réseau manque, le cache prend le relais
function quiet(promise) {
  return promise.catch(e => {
    if (!e.network && !e.silent) toast(e.message || 'Une erreur est survenue', 'error');
  });
}

function icon(name, cls) { return `<svg class="ic ${cls||''}"><use href="#i-${name}"/></svg>`; }
function formatVolume(v) {
  if (v >= 1000) return `${(v/1000).toLocaleString('fr-FR',{maximumFractionDigits:1})}<small>t</small>`;
  return `${Math.round(v).toLocaleString('fr-FR')}<small>kg</small>`;
}

// options.action + options.onAction : bouton dans le message (« Annuler »)
function toast(msg, type, options = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (type==='error' ? ' error' : '');
  el.setAttribute('role', type==='error' ? 'alert' : 'status');
  el.innerHTML = icon(type==='error' ? 'alert' : 'check') + `<span>${escapeHtml(msg)}</span>`;
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  const timer = setTimeout(dismiss, options.duration || 2400);
  if (options.action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = options.action;
    btn.onclick = () => { clearTimeout(timer); dismiss(); options.onAction(); };
    el.appendChild(btn);
  }
  document.getElementById('toasts').appendChild(el);
}
function undoToast(msg, onUndo) {
  toast(msg, '', { action: 'Annuler', duration: UNDO_MS, onAction: onUndo });
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.classList.add('modal-open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeModal(overlay.id));
  if (overlay.hasAttribute('data-dismiss')) {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = [...document.querySelectorAll('.modal-overlay.open')].pop();
    if (open) closeModal(open.id);
    return;
  }
  // Cartes cliquables : utilisables au clavier comme de vrais boutons
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"]')) {
    e.preventDefault();
    e.target.click();
  }
});

// Champ de poids : nettoyé avant que le reste de l'appli ne lise sa valeur
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.matches || !el.matches('.set-weight, [data-field="weight"]')) return;
  const cleaned = cleanWeightTyping(el.value);
  if (cleaned !== el.value) el.value = cleaned;
}, true);

// Identifiant créé sur le téléphone : une séance peut exister avant d'atteindre le serveur
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
