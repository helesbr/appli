// Minuteur de repos, son, écran allumé et notification de fin de repos
// --- MINUTEUR DE REPOS ---
let rest = null;      // { endAt, total, label, timer, finished }
let audioCtx = null;
let wakeLock = null;
const restEl = document.getElementById('restTimer');

// L'audio doit être activé pendant un geste de l'utilisateur (iOS)
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
function beep() {
  if (!audioCtx) return;
  [0, 0.22, 0.44].forEach((t, i) => {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = i === 2 ? 1320 : 880;
    osc.connect(gain); gain.connect(audioCtx.destination);
    const start = audioCtx.currentTime + t;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.start(start); osc.stop(start + 0.2);
  });
}
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// --- NOTIFICATION DE FIN DE REPOS ---
// iOS met l'appli en pause en arrière-plan : c'est le serveur qui envoie la notification (Web Push)
const NOTIF_ASKED_KEY = 'moggtrack-notif-asked';
const REST_NOTIF_TAG = 'rest-timer';
let pushKey = null;
let pushErrorShown = false;

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function restNotifAllowed() {
  return 'Notification' in window && Notification.permission === 'granted';
}
function swRegistration() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.getRegistration().catch(() => null);
}
async function loadPushKey() {
  if (!pushKey) pushKey = (await api('/api/push-key')).key;
  return pushKey;
}
function base64UrlToBytes(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
async function getPushSubscription(create) {
  const reg = await swRegistration();
  if (!reg || !reg.pushManager) return null;
  const existing = await reg.pushManager.getSubscription();
  if (existing || !create) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(await loadPushKey()) });
}
// Le bouton Notif reste visible tant que ce téléphone n'est pas abonné
async function updateRestBell() {
  const bell = document.getElementById('rtNotif');
  let active = false;
  try { active = pushSupported() && restNotifAllowed() && !!(await getPushSubscription(false)); } catch (e) {}
  bell.hidden = active;
}
// Doit partir d'un geste de l'utilisateur (obligatoire sur iPhone)
async function enableRestPush() {
  if (!pushSupported()) {
    toast('Sur iPhone : ajoute l\'appli à l\'écran d\'accueil et ouvre-la depuis son icône', 'error');
    return;
  }
  try {
    const result = await Notification.requestPermission();
    if (result === 'denied') {
      toast('Notifications bloquées : autorise-les dans les réglages du téléphone', 'error');
      return;
    }
    if (result !== 'granted') return;
    if (!(await getPushSubscription(true))) throw new Error('rouvre l\'appli puis réessaie');
    toast('Notification de fin de repos activée');
    updateRestBell();
    if (rest && !rest.finished) armRestNotification();
  } catch (e) {
    toast('Notification impossible : ' + e.message, 'error');
  }
}
// Proposé une seule fois au premier repos ; ensuite, le bouton Notif reste disponible
function askRestNotifications() {
  try {
    if (localStorage.getItem(NOTIF_ASKED_KEY)) return;
    localStorage.setItem(NOTIF_ASKED_KEY, '1');
  } catch (e) { return; }
  if (!pushSupported() || Notification.permission === 'default') enableRestPush();
}
function showPushError(e) {
  console.warn('Notification de repos :', e);
  if (pushErrorShown || (e && (e.silent || e.network))) return;
  pushErrorShown = true;
  toast('Notification de repos indisponible : ' + e.message, 'error');
}
// Programme la notification sur le serveur. Les requêtes s'enchaînent pour que
// +15 / -15 remplacent bien la précédente, même si elle n'a pas encore répondu.
function armRestNotification() {
  if (!rest || !pushSupported() || !restNotifAllowed()) return;
  const current = rest, previous = current.pushReq;
  current.pushReq = (async () => {
    const replaces = previous ? await previous : null;
    const sub = await getPushSubscription(true);
    if (!sub) return null;
    const seconds = Math.max(1, Math.ceil((current.endAt - Date.now()) / 1000));
    const res = await api('/api/rest-timer', {
      method: 'POST',
      keepalive: true,
      body: { seconds, label: current.label || '', subscription: sub.toJSON(), replaces }
    });
    return res.id;
  })().catch(e => { showPushError(e); return null; });
}
function cancelRestNotification() {
  const pending = rest && rest.pushReq;
  if (!pending) return;
  pending.then(id => {
    if (id) return api('/api/rest-timer/' + id, { method: 'DELETE', keepalive: true });
  }).catch(() => {});
}
async function closeRestNotification() {
  const reg = await swRegistration();
  if (!reg || !reg.getNotifications) return;
  const shown = await reg.getNotifications({ tag: REST_NOTIF_TAG }).catch(() => []);
  shown.forEach(n => n.close());
}
// Filet de sécurité (ordinateur, Android) : même tag que le serveur, donc pas de doublon
async function showRestNotification(label) {
  if (!restNotifAllowed()) return;
  const options = {
    body: (label ? label + ' : ' : '') + 'c\'est reparti !',
    tag: REST_NOTIF_TAG,
    icon: '/icons/icon-192.png',
    vibrate: [200, 100, 200]
  };
  try {
    const reg = await swRegistration();
    if (reg) await reg.showNotification('Repos terminé', options);
    else new Notification('Repos terminé', options);
  } catch (e) {}
}

function startRest(seconds, label) {
  stopRest();
  closeRestNotification().catch(() => {});
  askRestNotifications();
  rest = { endAt: Date.now() + seconds * 1000, total: seconds, label, finished: false };
  document.getElementById('rtLabel').textContent = 'Repos · ' + (label || 'exercice');
  restEl.classList.remove('finished');
  restEl.hidden = false;
  rest.timer = setInterval(tickRest, 250);
  updateRestBell();
  armRestNotification();
  tickRest();
}
// Calculé à partir de l'heure de fin : reste juste même si le téléphone met l'appli en pause
function tickRest() {
  if (!rest) return;
  const left = (rest.endAt - Date.now()) / 1000;
  document.getElementById('rtTime').textContent = fmtClock(left);
  document.getElementById('rtBar').style.width = Math.max(0, Math.min(100, left / rest.total * 100)) + '%';
  if (left <= 0 && !rest.finished) {
    rest.finished = true;
    restEl.classList.add('finished');
    document.getElementById('rtLabel').textContent = 'Repos terminé · c\'est reparti !';
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    if (document.hidden) showRestNotification(rest.label);
    const ended = rest;
    setTimeout(() => {
      if (rest === ended) stopRest();
      if (!document.hidden) closeRestNotification().catch(() => {});
    }, 6000);
  }
}
function stopRest() {
  if (rest) {
    clearInterval(rest.timer);
    if (!rest.finished) cancelRestNotification();
  }
  rest = null;
  restEl.hidden = true;
}
function adjustRest(delta) {
  if (!rest) return;
  if (rest.finished) {
    if (delta > 0) startRest(delta, rest.label);
    return;
  }
  rest.endAt += delta * 1000;
  rest.total = Math.max(rest.total, (rest.endAt - Date.now()) / 1000);
  armRestNotification();
  tickRest();
}
document.getElementById('rtMinus').onclick = () => adjustRest(-15);
document.getElementById('rtPlus').onclick = () => adjustRest(15);
document.getElementById('rtSkip').onclick = stopRest;
document.getElementById('rtNotif').onclick = enableRestPush;

// Garde l'écran allumé pendant la séance (si le navigateur le permet)
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  if (wakeLock) wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
}
function releaseAwake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
