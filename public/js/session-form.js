// Formulaire de création / modification d'une séance
function openNewSession(date) {
  editingSessionId = null;
  document.getElementById('modalTitle').textContent = 'Nouvelle séance';
  document.getElementById('sessionDate').value = date || formatDate(new Date());
  document.getElementById('sessionName').value = '';
  document.getElementById('blockList').innerHTML = '';
  document.getElementById('deleteSessionBtn').hidden = true;
  document.getElementById('duplicateSessionBtn').hidden = true;
  addBlockUI('single');
  openModal('sessionModal');
}
function openEditSession(id) {
  const session = sessions.find(s=>s.id===id);
  if (!session) return;
  editingSessionId = id;
  document.getElementById('modalTitle').textContent = 'Modifier la séance';
  document.getElementById('sessionDate').value = session.date;
  document.getElementById('sessionName').value = session.name;
  document.getElementById('blockList').innerHTML = '';
  document.getElementById('deleteSessionBtn').hidden = false;
  document.getElementById('duplicateSessionBtn').hidden = false;
  (session.blocks||[]).forEach(b => addBlockUI(b.type, b.exercises));
  openModal('sessionModal');
}
document.getElementById('addSessionBtn').onclick = () => openNewSession();
document.getElementById('closeModalBtn').onclick = () => closeModal('sessionModal');
document.getElementById('addSingleBtn').onclick = () => addBlockUI('single');
document.getElementById('addSupersetBtn').onclick = () => addBlockUI('superset');

// Boutons monter / descendre, partagés par les exercices des séances et des semaines types
function moveButtonsHTML() {
  return `<span class="move-btns">
    <button class="icon-btn move-up" aria-label="Monter l'exercice">${icon('up','ic-sm')}</button>
    <button class="icon-btn move-down" aria-label="Descendre l'exercice">${icon('down','ic-sm')}</button>
  </span>`;
}
// Dans un superset, l'exercice bouge dans le bloc ; sinon, tout le bloc échange sa place avec son voisin
function moveInForm(item, dir) {
  const sibling = dir < 0 ? item.previousElementSibling : item.nextElementSibling;
  if (sibling) return sibling.insertAdjacentElement(dir < 0 ? 'beforebegin' : 'afterend', item);
  const wrapper = item.closest('.block-wrapper');
  const neighbor = dir < 0 ? wrapper.previousElementSibling : wrapper.nextElementSibling;
  if (neighbor) neighbor.insertAdjacentElement(dir < 0 ? 'beforebegin' : 'afterend', wrapper);
}
function bindMoveButtons(item) {
  item.querySelector('.move-up').onclick = () => moveInForm(item, -1);
  item.querySelector('.move-down').onclick = () => moveInForm(item, 1);
}

// Builds a block wrapper; supersets get a header with a tag and actions
function createBlockWrapper(type, onAddExo) {
  const wrapper = document.createElement('div');
  wrapper.className = 'block-wrapper ' + type;
  wrapper.dataset.type = type;
  if (type === 'superset') {
    const header = document.createElement('div');
    header.className = 'block-header';
    header.innerHTML = `<span class="block-tag">${icon('zap')}Superset</span>
      <div class="inline-actions">
        <button class="btn btn-violet btn-sm add-exo">${icon('plus','ic-sm')}Exo</button>
        <button class="icon-btn danger remove-block" aria-label="Supprimer le superset">${icon('trash','ic-sm')}</button>
      </div>`;
    header.querySelector('.add-exo').onclick = onAddExo;
    header.querySelector('.remove-block').onclick = () => wrapper.remove();
    wrapper.appendChild(header);
  }
  return wrapper;
}
function removeExoFrom(el, container) {
  el.remove();
  if (!container.children.length) container.closest('.block-wrapper').remove();
}

function addBlockUI(type, exercises) {
  const wrapper = createBlockWrapper(type, () => addExoToBlock(wrapper));
  const exoContainer = document.createElement('div');
  exoContainer.className = 'exo-container';
  wrapper.appendChild(exoContainer);

  if (exercises && exercises.length > 0) {
    exercises.forEach(ex => addExoToBlock(wrapper, ex));
  } else {
    addExoToBlock(wrapper);
    if (type === 'superset') addExoToBlock(wrapper);
  }
  document.getElementById('blockList').appendChild(wrapper);
}

function setRowHTML(i, s) {
  return `<td><span class="set-idx">${i}</span></td>
    <td><input type="number" class="set-reps" inputmode="numeric" value="${s?escapeHtml(blankZero(s.reps)):''}" min="0" max="9999" placeholder="${s&&s.target?escapeHtml(s.target):'0'}"></td>
    <td><input type="text" class="set-weight" inputmode="decimal" autocomplete="off" value="${s?escapeHtml(blankZero(s.weight)):''}" placeholder="0" aria-label="Charge en kg"></td>
    <td><button class="icon-btn danger remove-set" aria-label="Supprimer la série">${icon('x','ic-sm')}</button></td>`;
}

function addExoToBlock(wrapper, ex) {
  const container = wrapper.querySelector('.exo-container');
  const div = document.createElement('div');
  div.className = 'exercise-block';
  const sets = ex ? ex.sets : [{reps:'',weight:''}];
  div.innerHTML = `
    <div class="exo-header">
      <input type="text" class="exo-name" list="exoSuggestions" autocomplete="off" placeholder="Nom de l'exercice" aria-label="Nom de l'exercice" value="${ex?escapeHtml(ex.name):''}" maxlength="200">
      ${moveButtonsHTML()}
      <label class="unit-input" title="Repos">${icon('timer')}<input type="number" class="exo-rest" inputmode="numeric" placeholder="–" value="${ex&&ex.rest?escapeHtml(ex.rest):''}" min="0" max="3600"><span>s</span></label>
      <button class="icon-btn danger remove-exo" aria-label="Supprimer l'exercice">${icon('trash','ic-sm')}</button>
    </div>
    <table class="sets-table">
      <thead><tr><th>#</th><th>Reps</th><th>Kg</th><th></th></tr></thead>
      <tbody>${sets.map((s,i)=>`<tr data-target="${escapeHtml(s.target||'')}" data-done="${s.done?'1':''}">${setRowHTML(i+1, s)}</tr>`).join('')}</tbody>
    </table>
    <button class="btn btn-ghost btn-sm add-set">${icon('plus','ic-sm')}Série</button>
    <textarea class="note-input exo-note" rows="1" maxlength="500" placeholder="Ajouter une note (réglage, sensation…)" aria-label="Note sur l'exercice">${ex&&ex.note?escapeHtml(ex.note):''}</textarea>
  `;
  div.querySelector('.remove-exo').onclick = () => removeExoFrom(div, container);
  bindMoveButtons(div);
  div.querySelector('.add-set').onclick = () => {
    const tbody=div.querySelector('tbody'); const idx=tbody.rows.length+1;
    const last = tbody.rows[tbody.rows.length-1];
    const prev = last ? { reps: last.querySelector('.set-reps').value, weight: normalizeWeight(last.querySelector('.set-weight').value), target: last.dataset.target } : null;
    const tr=document.createElement('tr');
    tr.dataset.target = prev && prev.target || '';
    tr.innerHTML=setRowHTML(idx, prev);
    tr.querySelector('.remove-set').onclick=()=>{tr.remove();renumberSets(div);};
    tbody.appendChild(tr);
  };
  div.querySelectorAll('.remove-set').forEach(btn=>{btn.onclick=()=>{btn.closest('tr').remove();renumberSets(div);};});
  container.appendChild(div);
}

function renumberSets(div) {
  div.querySelectorAll('tbody tr').forEach((tr,i)=>{tr.querySelector('.set-idx').textContent=i+1;});
}

// Lit le formulaire de séance ; renvoie null s'il manque la date ou le nom
function collectSessionForm() {
  const date = document.getElementById('sessionDate').value;
  const name = document.getElementById('sessionName').value.trim();
  if (!date||!name) { toast('Remplis la date et le nom', 'error'); return null; }
  const blocks = [];
  document.querySelectorAll('#blockList .block-wrapper').forEach(wrapper => {
    const type = wrapper.dataset.type;
    const exercises = [];
    wrapper.querySelectorAll('.exercise-block').forEach(block => {
      const exName = block.querySelector('.exo-name').value.trim();
      if (!exName) return;
      const sets = [];
      block.querySelectorAll('tbody tr').forEach(tr => {
        const reps=tr.querySelector('.set-reps').value;
        const weight=normalizeWeight(tr.querySelector('.set-weight').value);
        sets.push({reps, weight, target: tr.dataset.target || '', done: tr.dataset.done === '1'});
      });
      const rest = parseInt(block.querySelector('.exo-rest').value) || 0;
      const note = block.querySelector('.exo-note').value.trim();
      exercises.push({name:exName, sets, rest, note});
    });
    if (exercises.length>0) blocks.push({type, exercises});
  });
  return {date, name, blocks};
}
function persistSessionForm() {
  const body = collectSessionForm();
  if (!body) return null;
  const id = editingSessionId || newId();
  saveRecord('sessions', id, body);
  return { ...body, id };
}

document.getElementById('saveSessionBtn').onclick = () => {
  if (!persistSessionForm()) return;
  closeModal('sessionModal');
  toast(navigator.onLine ? 'Séance enregistrée' : 'Séance gardée sur le téléphone');
};
document.getElementById('startWorkoutBtn').onclick = () => {
  const saved = persistSessionForm();
  if (!saved) return;
  closeModal('sessionModal');
  openWorkout(saved.id);
};

document.getElementById('deleteSessionBtn').onclick = () => {
  if (!editingSessionId) return;
  const undo = deleteRecord('sessions', editingSessionId, UNDO_MS);
  closeModal('sessionModal');
  undoToast('Séance supprimée', undo);
};
