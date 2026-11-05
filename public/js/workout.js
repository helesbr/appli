// Mode séance : remplir les charges à la salle
const DEFAULT_REST = 90; // secondes, si l'exercice n'a pas de repos défini
const WEIGHT_STEP = 2.5;
let workout = null;      // copie de la séance en cours

// Dernière fois où l'exercice a été fait (séries avec des données), avant cette séance
function lastPerformance(name, beforeDate, excludeId) {
  const key = exerciseKey(name);
  if (!key) return null;
  let best = null;
  sessions.forEach(s => {
    if (s.id === excludeId || s.date > beforeDate) return;
    (s.blocks||[]).forEach(b => (b.exercises||[]).forEach(ex => {
      if (exerciseKey(ex.name) !== key) return;
      const sets = (ex.sets||[]).filter(st => num(st.weight) > 0 || num(st.reps) > 0);
      if (sets.length && (!best || s.date > best.date)) best = { date: s.date, sets };
    }));
  });
  return best;
}

function openWorkout(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return toast('Séance introuvable', 'error');
  workout = JSON.parse(JSON.stringify(s));
  workout.blocks = workout.blocks || [];
  closeModal('sessionModal');
  document.getElementById('workout').hidden = false;
  document.body.classList.add('modal-open');
  setWkStatus('');
  stopRest();
  renderWorkout();
  document.querySelector('.wk-scroll').scrollTop = 0;
  keepAwake();
}

function hideWorkout() {
  stopRest();
  releaseAwake();
  document.getElementById('workout').hidden = true;
  if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
  workout = null;
  renderWeek();
}

function renderWorkout() {
  const w = workout;
  document.getElementById('wkTitle').textContent = w.name;
  document.getElementById('wkFinishLabel').textContent = w.completed ? 'Enregistrer et fermer' : 'Terminer la séance';
  const body = document.getElementById('wkBody');
  body.innerHTML = '';
  w.blocks.forEach((block, bi) => {
    const bDiv = document.createElement('div');
    bDiv.className = 'block-wrapper' + (block.type === 'superset' ? ' superset' : '');
    if (block.type === 'superset') bDiv.innerHTML = `<div class="block-header"><span class="block-tag">${icon('zap')}Superset</span></div>`;
    (block.exercises||[]).forEach((ex, ei) => {
      ex.sets = ex.sets || [];
      const last = lastPerformance(ex.name, w.date, w.id);
      const lastNote = lastExerciseNote(sessions, ex.name, w.date, w.id);
      const isFirst = bi === 0 && ei === 0;
      const isLast = bi === w.blocks.length - 1 && ei === block.exercises.length - 1;
      const card = document.createElement('div');
      card.className = 'wk-exo';
      card.dataset.b = bi; card.dataset.e = ei;
      card.innerHTML = `
        <input class="wk-exo-name" data-field="name" list="exoSuggestions" autocomplete="off" value="${escapeHtml(ex.name)}" placeholder="Nom de l'exercice" maxlength="200" aria-label="Nom de l'exercice">
        <div class="wk-exo-tools">
          <button class="icon-btn" data-act="up" aria-label="Monter l'exercice"${isFirst ? ' disabled' : ''}>${icon('up','ic-sm')}</button>
          <button class="icon-btn" data-act="down" aria-label="Descendre l'exercice"${isLast ? ' disabled' : ''}>${icon('down','ic-sm')}</button>
          <button class="rest-pill" data-act="rest" title="Lancer le repos">${icon('timer')}${escapeHtml(parseInt(ex.rest) || DEFAULT_REST)}s</button>
          <button class="icon-btn danger" data-act="del-exo" aria-label="Retirer l'exercice">${icon('trash','ic-sm')}</button>
        </div>
        ${last ? `<div class="wk-last">${icon('history')}<span>Dernière fois (${frDate(last.date).slice(0,5)}) : ${last.sets.map(st => `<b>${escapeHtml(blankZero(st.weight)||0)}</b> kg × ${escapeHtml(blankZero(st.reps)||0)}`).join(' · ')}</span></div>` : ''}
        ${lastNote && lastNote.note !== String(ex.note || '').trim() ? `<div class="wk-last wk-last-note">${icon('note')}<span>Note du ${frDate(lastNote.date).slice(0,5)} : ${escapeHtml(lastNote.note)}</span></div>` : ''}
        <textarea class="note-input" data-field="note" rows="1" maxlength="500" placeholder="Ajouter une note (réglage, sensation…)" aria-label="Note sur l'exercice">${escapeHtml(ex.note || '')}</textarea>
        <div class="wk-sets-head"><span>#</span><span>Obj.</span><span>Reps</span><span>Kg</span><span>OK</span><span></span></div>
        ${ex.sets.map((st, si) => `
          <div class="wk-set${st.done ? ' done' : ''}" data-s="${si}">
            <span class="set-idx">${si + 1}</span>
            <span class="wk-target">${st.target ? escapeHtml(st.target) : '–'}</span>
            <input type="number" inputmode="numeric" data-field="reps" min="0" max="9999" value="${escapeHtml(blankZero(st.reps))}" placeholder="${escapeHtml(st.target || '0')}" aria-label="Reps">
            <input type="text" inputmode="decimal" autocomplete="off" data-field="weight" value="${escapeHtml(blankZero(st.weight))}" placeholder="${escapeHtml(last && last.sets[si] ? blankZero(last.sets[si].weight) || '0' : '0')}" aria-label="Charge en kg">
            <button class="wk-check" data-act="check" aria-label="Valider la série">${icon('check')}</button>
            <button class="icon-btn danger wk-del" data-act="del-set" aria-label="Supprimer la série">${icon('x','ic-sm')}</button>
            ${st.done ? '' : `<div class="wk-step">
              <button data-act="weight-down" aria-label="Retirer ${WEIGHT_STEP} kg">−${WEIGHT_STEP}</button>
              <button data-act="weight-up" aria-label="Ajouter ${WEIGHT_STEP} kg">+${WEIGHT_STEP}</button>
            </div>`}
          </div>`).join('')}
        <button class="btn btn-ghost btn-sm add-set" data-act="add-set">${icon('plus','ic-sm')}Série</button>`;
      bDiv.appendChild(card);
    });
    body.appendChild(bDiv);
  });
  if (!w.blocks.length) body.innerHTML = '<p class="empty">Aucun exercice pour l\'instant.<br>Ajoute le premier ci-dessous.</p>';
  updateWorkoutProgress();
}

function updateWorkoutProgress() {
  let total = 0, done = 0;
  workout.blocks.forEach(b => (b.exercises||[]).forEach(ex => (ex.sets||[]).forEach(st => { total++; if (st.done) done++; })));
  document.getElementById('wkMeta').textContent = `${frDay(workout.date)} · ${done}/${total} séries`;
  document.getElementById('wkBar').style.width = total ? (done / total * 100) + '%' : '0%';
  return total - done;
}

function setWkStatus(text, error) {
  const el = document.getElementById('wkStatus');
  el.textContent = text;
  el.classList.toggle('error', !!error);
}
// Chaque changement est écrit tout de suite sur le téléphone ; l'envoi au serveur attend une courte pause
function saveWorkout(flushDelay = 800) {
  if (!workout) return;
  const w = workout;
  saveRecord('sessions', w.id, {
    date: w.date,
    name: w.name,
    blocks: JSON.parse(JSON.stringify(w.blocks)),
    completed: !!w.completed
  }, { flushDelay });
}

// Retrouve l'exercice / la série correspondant à un élément de l'écran
function wkLocate(el) {
  const card = el.closest('.wk-exo');
  const bi = +card.dataset.b, ei = +card.dataset.e;
  const block = workout.blocks[bi], ex = block.exercises[ei];
  const row = el.closest('.wk-set');
  const si = row ? +row.dataset.s : -1;
  return { bi, ei, si, block, ex, set: row ? ex.sets[si] : null };
}
function scrollToExercise(pos) {
  const card = wkBody.querySelector(`.wk-exo[data-b="${pos.bi}"][data-e="${pos.ei}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Suppression en séance : rien ne bloque le geste, et « Annuler » remet tout en place
function undoableRemoval(message, remove) {
  const id = workout.id;
  const snapshot = JSON.parse(JSON.stringify(workout.blocks));
  remove();
  undoToast(message, () => {
    if (!workout || workout.id !== id) return;
    workout.blocks = snapshot;
    renderWorkout();
    saveWorkout();
  });
}

const wkBody = document.getElementById('wkBody');
wkBody.addEventListener('input', e => {
  const field = e.target.dataset.field;
  if (!field || !workout) return;
  const t = wkLocate(e.target);
  if (field === 'name' || field === 'note') t.ex[field] = e.target.value;
  else t.set[field] = field === 'weight' ? normalizeWeight(e.target.value) : e.target.value;
  saveWorkout();
});
wkBody.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !workout) return;
  const t = wkLocate(btn);
  const act = btn.dataset.act;
  let restAfter = null;
  if (act === 'rest') {
    unlockAudio();
    startRest(parseInt(t.ex.rest) || DEFAULT_REST, t.ex.name);
    return;
  }
  if (act === 'weight-up' || act === 'weight-down') {
    const input = btn.closest('.wk-set').querySelector('[data-field="weight"]');
    t.set.weight = stepWeight(t.set.weight, input.placeholder, act === 'weight-up' ? WEIGHT_STEP : -WEIGHT_STEP);
    input.value = t.set.weight;
    saveWorkout();
    return;
  }
  if (act === 'up' || act === 'down') {
    const pos = moveExercise(workout.blocks, t.bi, t.ei, act === 'up' ? -1 : 1);
    if (!pos) return;
    renderWorkout();
    saveWorkout();
    scrollToExercise(pos);
    return;
  }
  if (act === 'check') {
    t.set.done = !t.set.done;
    // Valider sans saisir les reps = objectif atteint
    if (t.set.done && blankZero(t.set.reps) === '' && parseInt(t.set.target)) t.set.reps = String(parseInt(t.set.target));
    if (t.set.done) {
      if (navigator.vibrate) navigator.vibrate(20);
      unlockAudio();
      // En superset, le repos se prend à la fin du tour (dernier exercice du bloc)
      if (t.block.type !== 'superset') restAfter = { seconds: parseInt(t.ex.rest) || DEFAULT_REST, label: t.ex.name };
      else if (t.ei === t.block.exercises.length - 1) {
        restAfter = { seconds: Math.max(...t.block.exercises.map(e => parseInt(e.rest) || 0)) || DEFAULT_REST, label: 'Superset' };
      }
    }
  } else if (act === 'del-set') {
    undoableRemoval('Série supprimée', () => t.ex.sets.splice(t.si, 1));
  } else if (act === 'add-set') {
    const prev = t.ex.sets[t.ex.sets.length - 1];
    t.ex.sets.push({ reps: '', weight: prev ? prev.weight : '', target: prev ? prev.target || '' : '', done: false });
  } else if (act === 'del-exo') {
    undoableRemoval(`« ${t.ex.name || 'Exercice'} » retiré`, () => {
      t.block.exercises.splice(t.ei, 1);
      if (!t.block.exercises.length) workout.blocks.splice(t.bi, 1);
    });
  }
  renderWorkout();
  saveWorkout();
  // Pas de repos après la toute dernière série
  if (restAfter && updateWorkoutProgress() > 0) startRest(restAfter.seconds, restAfter.label);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') closeRestNotification().catch(() => {});
  if (document.visibilityState === 'visible' && workout) { keepAwake(); tickRest(); }
});

document.getElementById('wkAddExo').onclick = () => {
  workout.blocks.push({ type: 'single', exercises: [{ name: '', rest: 0, sets: [{ reps: '', weight: '', target: '', done: false }] }] });
  renderWorkout();
  saveWorkout();
  const names = wkBody.querySelectorAll('.wk-exo-name');
  const input = names[names.length - 1];
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input.focus();
};

document.getElementById('wkBack').onclick = () => {
  saveWorkout(0);
  hideWorkout();
};

document.getElementById('wkFinish').onclick = () => {
  const remaining = updateWorkoutProgress();
  const wasCompleted = workout.completed;
  const id = workout.id;
  const snapshot = JSON.parse(JSON.stringify(workout.blocks));
  workout.blocks.forEach(b => { b.exercises = (b.exercises||[]).filter(ex => ex.name.trim()); });
  workout.blocks = workout.blocks.filter(b => b.exercises.length);
  workout.completed = true;
  saveWorkout(0);
  hideWorkout();
  if (wasCompleted) return toast('Séance enregistrée');
  const skipped = remaining > 0 ? ` · ${remaining} série${remaining > 1 ? 's' : ''} non validée${remaining > 1 ? 's' : ''}` : '';
  undoToast(`Séance terminée 💪${skipped}`, () => {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    saveRecord('sessions', id, { date: s.date, name: s.name, blocks: snapshot, completed: false });
    openWorkout(id);
  });
};
