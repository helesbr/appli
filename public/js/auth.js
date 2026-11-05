// Connexion, démarrage de l'appli et rafraîchissement des données
const REFRESH_MIN_MS = 30000;
let lastRefreshAt = 0;

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Appareil';
  const installed = window.matchMedia && matchMedia('(display-mode: standalone)').matches;
  return os + (installed ? ' (appli)' : ' (navigateur)');
}
// L'identifiant de l'appareil survit à la fin de la connexion du jour : on retrouve la même fiche demain
const DEVICE_KEY = 'moggtrack-device';
function rememberDevice() {
  const token = getToken();
  if (!token || !token.startsWith('d.')) return;
  try { localStorage.setItem(DEVICE_KEY, token.split('.')[1]); } catch (e) {}
}
function rememberedDevice() {
  try { return localStorage.getItem(DEVICE_KEY); } catch (e) { return null; }
}
function forgetDevice() {
  try { localStorage.removeItem(DEVICE_KEY); } catch (e) {}
}

function startApp() {
  document.getElementById('loginScreen').hidden = true;
  quiet(loadSessions());
  quiet(loadTemplates());
  loadPushKey().catch(() => {});
  flushOutbox();
}
function showLogin(message) {
  rememberDevice();
  setToken(null);
  sessions = []; templates = []; perfs = [];
  if ('caches' in window) caches.delete('moggtrack-api').catch(() => {});
  document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id));
  const err = document.getElementById('loginError');
  err.textContent = message || '';
  err.hidden = !message;
  document.getElementById('loginScreen').hidden = false;
  setTimeout(() => document.getElementById('loginPassword').focus(), 50);
}
document.getElementById('loginForm').onsubmit = async e => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const input = document.getElementById('loginPassword');
  const err = document.getElementById('loginError');
  btn.disabled = true; btn.textContent = 'Connexion…'; err.hidden = true;
  try {
    let res;
    try {
      res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value, deviceId: rememberedDevice(), deviceName: deviceName() }) });
    } catch (e) { throw new Error('Pas de connexion internet'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Connexion impossible');
    setToken(data.token);
    input.value = '';
    startApp();
    toast('Connecté');
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
    input.select();
  } finally {
    btn.disabled = false; btn.textContent = 'Se connecter';
  }
};

window.addEventListener('offline', () => {
  toast('Hors connexion : tes modifications restent gardées sur le téléphone');
  updateSyncUI();
});
window.addEventListener('online', () => {
  toast('De nouveau en ligne');
  if (getToken()) { flushOutbox(); quiet(loadSessions()); }
});
// Pas de rechargement en continu : uniquement au retour dans l'appli, et pas plus d'une fois par 30 s
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !getToken() || Date.now() - lastRefreshAt < REFRESH_MIN_MS) return;
  flushOutbox();
  quiet(loadSessions());
});

async function loadSessions() {
  lastRefreshAt = Date.now();
  const data = await api('/api/sessions');
  sessions = applyOutbox(Array.isArray(data) ? data : [], outbox, 'sessions');
  refreshExerciseSuggestions();
  renderWeek();
}
