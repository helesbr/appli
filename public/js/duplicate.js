// Dupliquer une séance depuis le planning : la copie arrive vierge, prête à refaire
let dupSourceId = null;

function renderDupDays() {
  const selected = document.getElementById('dupDate').value;
  const days = document.getElementById('dupDays');
  days.innerHTML = '';
  if (!selected) return;
  const monday = formatDate(getMonday(new Date(selected + 'T12:00:00')));
  DAYS_SHORT.forEach((label, i) => {
    const date = addDaysIso(monday, i);
    const btn = document.createElement('button');
    btn.className = date === selected ? 'active' : '';
    btn.setAttribute('aria-label', frDay(date));
    btn.innerHTML = `${label}<b>${Number(date.slice(8))}</b>`;
    btn.onclick = () => {
      document.getElementById('dupDate').value = date;
      renderDupDays();
    };
    days.appendChild(btn);
  });
}

function openDuplicate(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return toast('Séance introuvable', 'error');
  dupSourceId = id;
  document.getElementById('dupName').textContent = session.name;
  // Par défaut, le même jour la semaine suivante
  document.getElementById('dupDate').value = addDaysIso(session.date, 7);
  renderDupDays();
  closeModal('sessionModal');
  openModal('dupModal');
}

document.getElementById('dupDate').addEventListener('change', renderDupDays);
document.getElementById('closeDupBtn').onclick = () => closeModal('dupModal');
document.getElementById('duplicateSessionBtn').onclick = () => openDuplicate(editingSessionId);
document.getElementById('confirmDupBtn').onclick = () => {
  const session = sessions.find(s => s.id === dupSourceId);
  const date = document.getElementById('dupDate').value;
  if (!session) return toast('Séance introuvable', 'error');
  if (!date) return toast('Choisis une date pour la copie', 'error');
  const id = newId();
  // Le planning se place sur la semaine de la copie pour la montrer tout de suite
  currentWeekStart = getMonday(new Date(date + 'T12:00:00'));
  saveRecord('sessions', id, duplicateSession(session, date));
  closeModal('dupModal');
  undoToast(`« ${session.name} » copiée au ${frDay(date)}`, () => deleteRecord('sessions', id));
};
