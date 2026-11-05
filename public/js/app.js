// Navigation et démarrage : ce fichier est chargé en dernier
document.querySelectorAll('.nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    showPage(btn.dataset.page);
    window.scrollTo({ top: 0 });
  });
});
function showPage(page) {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (page === 'topperf') quiet(loadPerfs());
  if (page === 'templates') quiet(loadTemplates());
}

updateSyncUI();
renderWeek();
if (getToken()) startApp(); else showLogin();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
