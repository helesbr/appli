// Formulaire d'une course à pied : objectif (prévu) et réalisé (saisi ou importé de Strava)
let editingRunId = null;
let runFeeling = 0;

const FEELING_EMOJI = ['', '😵', '😣', '😐', '🙂', '🤩'];
document.getElementById('runType').innerHTML = Object.entries(RUN_TYPES)
  .map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
document.getElementById('runFeeling').innerHTML = [1, 2, 3, 4, 5]
  .map(n => `<button type="button" data-feeling="${n}" aria-pressed="false" aria-label="${RUN_FEELINGS[n]}">${FEELING_EMOJI[n]}<span>${RUN_FEELINGS[n]}</span></button>`).join('');

const runField = id => document.getElementById(id);
const kmValue = v => (num(v) > 0 ? String(v).replace('.', ',') : '');

function setRunFeeling(value) {
  runFeeling = value;
  document.querySelectorAll('#runFeeling button').forEach(b => {
    const on = Number(b.dataset.feeling) === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
}
function updateRunPace() {
  const pace = formatPace(paceSeconds(num(runField('runDistance').value.replace(',', '.')), parseDuration(runField('runDuration').value)));
  runField('runPace').textContent = pace ? `${pace} /km` : '';
}

function fillRunForm(session) {
  const r = (session && session.run) || {};
  const t = r.target || {};
  runField('runDate').value = session ? session.date : formatDate(new Date());
  runField('runType').value = RUN_TYPES[r.type] ? r.type : 'footing';
  runField('runName').value = session ? session.name : '';
  runField('runTargetDistance').value = kmValue(t.distanceKm);
  runField('runTargetDuration').value = formatDuration(t.durationSec);
  runField('runTargetDetails').value = t.details || '';
  runField('runDistance').value = kmValue(r.distanceKm);
  runField('runDuration').value = formatDuration(r.durationSec);
  runField('runElevation').value = blankZero(r.elevation);
  runField('runAvgHr').value = blankZero(r.avgHr);
  runField('runMaxHr').value = blankZero(r.maxHr);
  runField('runNotes').value = r.notes || '';
  setRunFeeling(Number(r.feeling) || 0);
  runField('runStravaBadge').hidden = !r.stravaId;
  runField('runStravaCredit').hidden = !r.stravaId;
  updateRunPace();
}

function openNewRun(date) {
  editingRunId = null;
  fillRunForm(null);
  if (date) runField('runDate').value = date;
  runField('runModalTitle').textContent = 'Nouvelle course';
  runField('runKindSwitch').hidden = false;
  runField('deleteRunBtn').hidden = true;
  runField('duplicateRunBtn').hidden = true;
  openModal('runModal');
}
function openEditRun(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return toast('Course introuvable', 'error');
  editingRunId = id;
  fillRunForm(session);
  runField('runModalTitle').textContent = 'Modifier la course';
  runField('runKindSwitch').hidden = true;
  runField('deleteRunBtn').hidden = false;
  runField('duplicateRunBtn').hidden = false;
  openModal('runModal');
}

// Lit le formulaire ; renvoie null (avec un message) s'il manque la date ou si une durée est illisible
function collectRunForm() {
  const date = runField('runDate').value;
  if (!date) { toast('Choisis la date de la course', 'error'); return null; }
  const targetDuration = parseDuration(runField('runTargetDuration').value);
  const duration = parseDuration(runField('runDuration').value);
  if (Number.isNaN(targetDuration) || Number.isNaN(duration)) {
    toast('Durée illisible : écris par exemple 45, 45:30 ou 1:02:10', 'error');
    return null;
  }
  const type = runField('runType').value;
  const previous = editingRunId && sessions.find(s => s.id === editingRunId);
  const run = {
    type,
    target: {
      distanceKm: num(runField('runTargetDistance').value.replace(',', '.')),
      durationSec: targetDuration,
      details: runField('runTargetDetails').value.trim()
    },
    distanceKm: num(runField('runDistance').value.replace(',', '.')),
    durationSec: duration,
    elevation: num(runField('runElevation').value),
    avgHr: num(runField('runAvgHr').value),
    maxHr: num(runField('runMaxHr').value),
    feeling: runFeeling,
    notes: runField('runNotes').value.trim()
  };
  // Une course importée garde son lien avec Strava : elle ne sera pas réimportée
  if (previous && previous.run && previous.run.stravaId) run.stravaId = previous.run.stravaId;
  return {
    date,
    name: runField('runName').value.trim() || RUN_TYPES[type],
    kind: 'run',
    blocks: [],
    run,
    completed: run.distanceKm > 0 || run.durationSec > 0
  };
}

runField('runFeeling').onclick = e => {
  const btn = e.target.closest('[data-feeling]');
  if (!btn) return;
  const value = Number(btn.dataset.feeling);
  setRunFeeling(runFeeling === value ? 0 : value);
};
runField('runDistance').addEventListener('input', updateRunPace);
runField('runDuration').addEventListener('input', updateRunPace);

runField('saveRunBtn').onclick = () => {
  const body = collectRunForm();
  if (!body) return;
  saveRecord('sessions', editingRunId || newId(), body);
  closeModal('runModal');
  toast(navigator.onLine ? 'Course enregistrée' : 'Course gardée sur le téléphone');
};
runField('closeRunBtn').onclick = () => closeModal('runModal');
runField('deleteRunBtn').onclick = () => {
  if (!editingRunId) return;
  const undo = deleteRecord('sessions', editingRunId, UNDO_MS);
  closeModal('runModal');
  undoToast('Course supprimée', undo);
};
runField('duplicateRunBtn').onclick = () => openDuplicate(editingRunId);

// Passer d'une séance de muscu à une course (et inversement) en gardant la date choisie
function bindKindSwitch(switchId, onPick) {
  document.getElementById(switchId).onclick = e => {
    const btn = e.target.closest('[data-kind]');
    if (btn && !btn.classList.contains('active')) onPick(btn.dataset.kind);
  };
}
bindKindSwitch('runKindSwitch', () => {
  const date = runField('runDate').value;
  closeModal('runModal');
  openNewSession(date);
});
bindKindSwitch('sessionKindSwitch', () => {
  const date = document.getElementById('sessionDate').value;
  closeModal('sessionModal');
  openNewRun(date);
});
