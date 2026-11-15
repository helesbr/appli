// Strava : connexion depuis les réglages et import automatique des courses
// (enregistrées avec l'appli Strava ou l'Apple Watch synchronisée avec Strava)

function stravaSyncAgo(value) {
  if (!value) return 'jamais synchronisé';
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'synchronisé à l\'instant';
  if (minutes < 60) return `synchronisé il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synchronisé il y a ${hours} h`;
  return `synchronisé le ${frDate(formatDate(new Date(value)))}`;
}

// Le serveur limite lui-même la fréquence : on peut appeler ceci à chaque ouverture de l'appli.
// Des appels simultanés (retour de Strava + démarrage) partagent une seule synchronisation et un seul message.
let stravaSyncInFlight = null;
function syncStrava(force) {
  if (!stravaSyncInFlight) stravaSyncInFlight = runStravaSync(force).finally(() => { stravaSyncInFlight = null; });
  return stravaSyncInFlight;
}
async function runStravaSync(force) {
  const result = await api('/api/strava/sync', { method: 'POST', body: { force: !!force } });
  const count = (result.created || 0) + (result.completed || 0);
  if (count || result.enriched) await loadSessions();
  if (count) toast(`${count} course${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''} depuis Strava`);
  return result;
}

// --- NOTIFICATION « COURSE IMPORTÉE » ---
// Le serveur garde l'abonnement de chaque appareil pour le prévenir quand une course arrive de Strava
async function registerDevicePush(create) {
  if (!pushSupported() || !restNotifAllowed()) return false;
  const subscription = await getPushSubscription(create);
  if (!subscription) return false;
  await api('/api/devices/current/push', { method: 'PUT', body: { subscription: subscription.toJSON() } });
  return true;
}
// Doit partir d'un geste de l'utilisateur (obligatoire sur iPhone)
async function enableRunNotifications() {
  if (!pushSupported()) {
    toast('Sur iPhone : ajoute l\'appli à l\'écran d\'accueil et ouvre-la depuis son icône', 'error');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast('Notifications bloquées : autorise-les dans les réglages du téléphone', 'error');
    return;
  }
  if (await registerDevicePush(true)) toast('Tu seras prévenu à chaque course importée');
  else toast('Notification impossible : rouvre l\'appli puis réessaie', 'error');
}
function autoSyncStrava() {
  if (!navigator.onLine || !getToken()) return;
  syncStrava(false).catch(() => {});
  // Un téléphone qui accepte déjà les notifications (fin de repos) est aussi prévenu des courses importées
  registerDevicePush(false).catch(() => {});
}

async function loadStravaSettings() {
  const status = document.getElementById('stravaStatus');
  const connectBtn = document.getElementById('stravaConnectBtn');
  const syncBtn = document.getElementById('stravaSyncBtn');
  const disconnectBtn = document.getElementById('stravaDisconnectBtn');
  [connectBtn, syncBtn, disconnectBtn].forEach(b => { b.hidden = true; });
  document.getElementById('stravaExtras').hidden = true;
  status.classList.remove('error');
  status.textContent = 'Vérification…';
  try {
    const info = await api('/api/strava');
    if (!info.configured) {
      status.textContent = 'Pas encore configuré : ajoute STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans Vercel.';
    } else if (info.connected) {
      status.textContent = `Connecté${info.athleteName ? ' au compte ' + info.athleteName : ''} · ${stravaSyncAgo(info.lastSyncAt)}. Tes courses arrivent toutes seules.`;
      syncBtn.hidden = false;
      disconnectBtn.hidden = false;
      renderStravaExtras(info);
    } else {
      status.textContent = 'Connecte ton compte pour importer tes courses, y compris celles de ton Apple Watch.';
      connectBtn.hidden = false;
    }
  } catch (e) {
    if (e.silent) return;
    status.textContent = e.network ? 'Hors connexion : Strava indisponible' : e.message;
    status.classList.add('error');
  }
}

// Import instantané (alertes Strava) et notification sur cet appareil
async function renderStravaExtras(info) {
  document.getElementById('stravaExtras').hidden = false;
  document.getElementById('stravaInstantStatus').textContent = info.instant
    ? 'Import instantané activé : une course arrive dès qu\'elle est enregistrée sur Strava.'
    : 'Import instantané inactif : tes courses arrivent à l\'ouverture de l\'appli.';
  document.getElementById('stravaInstantBtn').hidden = !!info.instant;
  let notified = false;
  try { notified = pushSupported() && restNotifAllowed() && !!(await getPushSubscription(false)); } catch (e) {}
  document.getElementById('stravaNotifStatus').textContent = notified
    ? 'Notification activée sur cet appareil à chaque course importée.'
    : 'Active la notification pour être prévenu quand une course arrive.';
  document.getElementById('stravaNotifBtn').hidden = notified;
}
document.getElementById('stravaInstantBtn').onclick = async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await api('/api/strava/webhook/setup', { method: 'POST', body: {} });
    toast('Import instantané activé');
    loadStravaSettings();
  } finally {
    btn.disabled = false;
  }
};
document.getElementById('stravaNotifBtn').onclick = async () => {
  await enableRunNotifications();
  loadStravaSettings();
};

document.getElementById('stravaConnectBtn').onclick = async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const { url } = await api('/api/strava/connect-url');
    window.location.href = url;
  } finally {
    btn.disabled = false;
  }
};
document.getElementById('stravaSyncBtn').onclick = async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const result = await syncStrava(true);
    if (!result.connected) toast('Strava n\'est plus connecté : reconnecte-le', 'error');
    else if (!result.created && !result.completed) toast('Aucune nouvelle course sur Strava');
  } finally {
    btn.disabled = false;
    loadStravaSettings();
  }
};
document.getElementById('stravaDisconnectBtn').onclick = async () => {
  if (!confirm('Déconnecter Strava ? Les courses déjà importées restent dans l\'appli.')) return;
  await api('/api/strava', { method: 'DELETE' });
  toast('Strava déconnecté');
  loadStravaSettings();
};

// Retour de la page Strava (/?strava=connected) : message, puis première importation
(function handleStravaReturn() {
  const result = new URLSearchParams(window.location.search).get('strava');
  if (!result) return;
  history.replaceState(null, '', '/');
  if (result === 'connected') {
    toast('Strava connecté');
    if (getToken()) syncStrava(true).catch(() => {});
  } else {
    toast('Connexion à Strava impossible', 'error');
  }
})();
