// Réglages : export des données, appareils connectés et état du serveur
function timeAgo(value) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return 'aujourd\'hui';
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

async function loadDevices() {
  const list = document.getElementById('deviceList');
  list.innerHTML = '<p class="settings-note">Chargement…</p>';
  try {
    const devices = await api('/api/devices');
    list.innerHTML = '';
    if (!devices.length) list.innerHTML = '<p class="settings-note">Aucun appareil enregistré.</p>';
    devices.forEach(device => {
      const row = document.createElement('div');
      row.className = 'settings-row';
      row.innerHTML = `<div class="settings-row-info">
          <div class="settings-row-title">${escapeHtml(device.name)}${device.current ? ' <span class="tag-current">cet appareil</span>' : ''}</div>
          <div class="settings-note">Utilisé ${timeAgo(device.lastSeen)}</div>
        </div>
        <button class="btn btn-secondary btn-sm">Déconnecter</button>`;
      row.querySelector('button').onclick = () => logoutDevice(device);
      list.appendChild(row);
    });
  } catch (e) {
    if (!e.silent) list.innerHTML = `<p class="settings-note">Liste indisponible : ${escapeHtml(e.message)}</p>`;
  }
}
async function logoutDevice(device) {
  await api('/api/devices/' + device.id, { method: 'DELETE' });
  if (device.current) {
    closeModal('settingsModal');
    showLogin();
    forgetDevice();
    renderWeek();
    return;
  }
  toast(`${device.name} déconnecté`);
  loadDevices();
}

async function loadHealth() {
  const el = document.getElementById('healthStatus');
  el.textContent = 'Vérification…';
  try {
    const res = await fetch('/api/health');
    const { ok, checks } = await res.json();
    const problems = [];
    if (!checks.database) problems.push('base de données injoignable');
    if (!checks.notifications) problems.push('notifications non configurées');
    if (checks.recentErrors) problems.push(`${checks.recentErrors} erreur(s) dans la dernière heure`);
    el.textContent = ok && !problems.length ? 'Tout fonctionne' : problems.join(' · ');
    el.classList.toggle('error', problems.length > 0);
  } catch (e) {
    el.textContent = 'Serveur injoignable pour le moment';
    el.classList.add('error');
  }
}

// Sur téléphone, le menu de partage permet d'enregistrer dans Fichiers ; sinon téléchargement classique
async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function exportData(format, button) {
  button.disabled = true;
  try {
    let res;
    try {
      res = await fetch('/api/export?format=' + format, { headers: { Authorization: 'Bearer ' + getToken() } });
    } catch (e) { throw new Error('Pas de connexion : l\'export demande le réseau'); }
    if (!res.ok) throw new Error('Export impossible pour le moment');
    const blob = await res.blob();
    await shareOrDownload(blob, `moggtrack-${formatDate(new Date())}.${format}`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    button.disabled = false;
  }
}

document.getElementById('settingsBtn').onclick = () => {
  const count = pendingCount();
  document.getElementById('settingsSync').textContent = count
    ? `${count} modification${count > 1 ? 's' : ''} en attente d'envoi`
    : 'Toutes tes modifications sont envoyées';
  openModal('settingsModal');
  loadDevices();
  loadHealth();
};
document.getElementById('exportJsonBtn').onclick = e => exportData('json', e.currentTarget);
document.getElementById('exportCsvBtn').onclick = e => exportData('csv', e.currentTarget);
document.getElementById('closeSettingsBtn').onclick = () => closeModal('settingsModal');
document.getElementById('logoutBtn').onclick = async () => {
  const count = pendingCount();
  if (count && !confirm(`${count} modification${count > 1 ? 's' : ''} pas encore envoyée${count > 1 ? 's' : ''}. Elles seront envoyées à ta prochaine connexion. Te déconnecter ?`)) return;
  const token = getToken();
  closeModal('settingsModal');
  // Sans réseau, la déconnexion reste effective sur ce téléphone
  if (token) {
    const id = token.split('.')[1];
    if (token.startsWith('d.')) api('/api/devices/' + id, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
  showLogin();
  forgetDevice();
  renderWeek();
};
document.getElementById('logoutAllBtn').onclick = async () => {
  if (!confirm('Déconnecter tous les appareils, y compris celui-ci ? Il faudra retaper le mot de passe partout.')) return;
  await api('/api/devices/logout-all', { method: 'POST', body: {} });
  closeModal('settingsModal');
  showLogin('Tous les appareils sont déconnectés');
  forgetDevice();
  renderWeek();
};
