// Semaines types
async function loadTemplates() {
  const data = await api('/api/templates');
  templates = applyOutbox(Array.isArray(data) ? data : [], outbox, 'templates');
  refreshExerciseSuggestions();
  renderTemplates();
}

function templateCardHTML(tpl) {
  const days = new Set(tpl.sessions.map(s=>s.dayOfWeek));
  const strip = DAYS_LETTER.map((l,i)=>`<span class="${days.has(i+1)?'on':''}">${l}</span>`).join('');
  const sessionsInfo = [...tpl.sessions].sort((a,b)=>a.dayOfWeek-b.dayOfWeek)
    .map(s=>`<span class="tpl-day-label"><b>${DAYS_SHORT[s.dayOfWeek-1]}</b>${escapeHtml(s.name)}</span>`).join('');
  return `
    <div class="tpl-card-header">
      <span class="tpl-card-name">${escapeHtml(tpl.name)}</span>
      ${tpl.weekType ? `<span class="tpl-card-type">${escapeHtml(tpl.weekType)}</span>` : ''}
    </div>
    <div class="week-strip">${strip}</div>
    <div class="tpl-card-sessions">${sessionsInfo||'Aucune séance'}</div>`;
}

function renderTemplates() {
  const list = document.getElementById('tplList');
  const empty = document.getElementById('tplEmpty');
  list.innerHTML = '';
  empty.style.display = templates.length===0?'block':'none';
  templates.forEach(tpl => {
    const div = document.createElement('div');
    div.className = 'tpl-card card';
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    div.innerHTML = templateCardHTML(tpl);
    div.onclick = () => openEditTemplate(tpl.id);
    list.appendChild(div);
  });
}

document.getElementById('addTplBtn').onclick = () => openNewTemplate();
document.getElementById('closeTplModalBtn').onclick = () => closeModal('tplModal');

function openNewTemplate() {
  editingTplId = null;
  document.getElementById('tplModalTitle').textContent = 'Nouveau template';
  document.getElementById('tplName').value = '';
  document.getElementById('tplWeekType').value = '';
  document.getElementById('tplSessionList').innerHTML = '';
  document.getElementById('deleteTplBtn').hidden = true;
  addTplSessionUI();
  openModal('tplModal');
}

function openEditTemplate(id) {
  const tpl = templates.find(t=>t.id===id);
  if (!tpl) return;
  editingTplId = id;
  document.getElementById('tplModalTitle').textContent = 'Modifier le template';
  document.getElementById('tplName').value = tpl.name;
  document.getElementById('tplWeekType').value = tpl.weekType||'';
  document.getElementById('tplSessionList').innerHTML = '';
  document.getElementById('deleteTplBtn').hidden = false;
  tpl.sessions.forEach(s => addTplSessionUI(s));
  openModal('tplModal');
}

document.getElementById('addTplSessionBtn').onclick = () => addTplSessionUI();

function addTplSessionUI(s) {
  const div = document.createElement('div');
  div.className = 'tpl-session';
  const dayOptions = DAYS.map((d,i)=>`<option value="${i+1}" ${s&&s.dayOfWeek===i+1?'selected':''}>${d}</option>`).join('');
  div.innerHTML = `
    <div class="tpl-session-head">
      <select class="tpl-day">${dayOptions}</select>
      <input type="text" class="tpl-session-name" placeholder="Push, Pull…" value="${s?escapeHtml(s.name):''}" maxlength="200">
      <button class="icon-btn lg danger remove-tpl-session" aria-label="Supprimer la séance">${icon('trash','ic-sm')}</button>
    </div>
    <div class="tpl-blocks"></div>
    <div class="inline-actions" style="margin-top:4px;">
      <button class="btn btn-ghost btn-sm add-tpl-single" style="flex:1;">${icon('plus','ic-sm')}Exercice</button>
      <button class="btn btn-violet btn-sm add-tpl-superset" style="flex:1;">${icon('zap','ic-sm')}Superset</button>
    </div>
  `;
  div.querySelector('.remove-tpl-session').onclick = () => div.remove();
  div.querySelector('.add-tpl-single').onclick = () => addTplBlockUI(div.querySelector('.tpl-blocks'),'single');
  div.querySelector('.add-tpl-superset').onclick = () => addTplBlockUI(div.querySelector('.tpl-blocks'),'superset');

  const blocksContainer = div.querySelector('.tpl-blocks');
  if (s && s.blocks && s.blocks.length > 0) {
    s.blocks.forEach(b => addTplBlockUI(blocksContainer, b.type, b.exercises));
  } else {
    addTplBlockUI(blocksContainer, 'single');
  }

  document.getElementById('tplSessionList').appendChild(div);
}

function addTplBlockUI(container, type, exercises) {
  const bDiv = createBlockWrapper(type, () => addTplExoUI(bDiv.querySelector('.tpl-exo-container')));
  const exoC = document.createElement('div');
  exoC.className = 'tpl-exo-container';
  bDiv.appendChild(exoC);

  if (exercises && exercises.length > 0) {
    exercises.forEach(ex => addTplExoUI(exoC, ex));
  } else {
    addTplExoUI(exoC);
    if (type==='superset') addTplExoUI(exoC);
  }
  container.appendChild(bDiv);
}

function addTplExoUI(container, ex) {
  const div = document.createElement('div');
  div.className = 'tpl-exo-row';
  div.innerHTML = `
    <input type="text" class="tpl-exo-name" list="exoSuggestions" autocomplete="off" placeholder="Exercice" aria-label="Nom de l'exercice" value="${ex?escapeHtml(ex.name):''}" maxlength="200">
    ${moveButtonsHTML()}
    <label class="unit-input" title="Séries"><input type="number" class="tpl-exo-sets" inputmode="numeric" placeholder="4" value="${ex?escapeHtml(ex.setsCount):4}" min="1" max="20"><span>séries</span></label>
    <label class="unit-input" title="Reps visées (ex : 8 ou 8-10)"><span>×</span><input type="text" class="tpl-exo-reps" inputmode="numeric" placeholder="8" value="${ex&&ex.reps?escapeHtml(ex.reps):''}" maxlength="10"><span>reps</span></label>
    <label class="unit-input" title="Repos">${icon('timer')}<input type="number" class="tpl-exo-rest" inputmode="numeric" placeholder="–" value="${ex&&ex.rest?escapeHtml(ex.rest):''}" min="0" max="3600"><span>s</span></label>
    <button class="icon-btn danger remove-tpl-exo" aria-label="Supprimer l'exercice">${icon('x','ic-sm')}</button>
  `;
  div.querySelector('.remove-tpl-exo').onclick = () => removeExoFrom(div, container);
  bindMoveButtons(div);
  container.appendChild(div);
}

document.getElementById('saveTplBtn').onclick = () => {
  const name = document.getElementById('tplName').value.trim();
  const weekType = document.getElementById('tplWeekType').value.trim();
  if (!name) return toast('Donne un nom au template', 'error');
  const tplSessions = [];
  document.querySelectorAll('#tplSessionList > div').forEach(sDiv => {
    const sName = sDiv.querySelector('.tpl-session-name').value.trim();
    const dayOfWeek = parseInt(sDiv.querySelector('.tpl-day').value);
    if (!sName) return;
    const blocks = [];
    sDiv.querySelectorAll('.block-wrapper').forEach(bw => {
      const type = bw.dataset.type;
      const exercises = [];
      bw.querySelectorAll('.tpl-exo-container > div').forEach(exDiv => {
        const eName = exDiv.querySelector('.tpl-exo-name').value.trim();
        const setsCount = parseInt(exDiv.querySelector('.tpl-exo-sets').value)||4;
        const rest = parseInt(exDiv.querySelector('.tpl-exo-rest').value) || 0;
        const reps = exDiv.querySelector('.tpl-exo-reps').value.trim();
        if (eName) exercises.push({name:eName, setsCount, reps, rest});
      });
      if (exercises.length>0) blocks.push({type, exercises});
    });
    tplSessions.push({name:sName, dayOfWeek, blocks});
  });
  const body = {name, weekType, sessions:tplSessions};
  saveRecord('templates', editingTplId || newId(), body);
  closeModal('tplModal');
  toast(navigator.onLine ? 'Template enregistré' : 'Template gardé sur le téléphone');
};

document.getElementById('deleteTplBtn').onclick = () => {
  if (!editingTplId) return;
  const undo = deleteRecord('templates', editingTplId, UNDO_MS);
  closeModal('tplModal');
  undoToast('Template supprimé', undo);
};

// --- APPLY TEMPLATE ---
document.getElementById('applyTplBtn').onclick = async () => {
  await quiet(loadTemplates());
  const list = document.getElementById('applyTplList');
  const empty = document.getElementById('applyTplEmpty');
  document.getElementById('applyTplWeek').textContent = 'Semaine du ' + frDateRange(currentWeekStart);
  list.innerHTML = '';
  empty.style.display = templates.length===0?'block':'none';
  templates.forEach(tpl => {
    const btn = document.createElement('div');
    btn.className = 'tpl-card card';
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    btn.style.background = 'var(--surface-2)';
    btn.innerHTML = templateCardHTML(tpl);
    btn.onclick = async () => {
      const res = await api('/api/templates/'+tpl.id+'/apply',{method:'POST',body:{weekStart:formatDate(currentWeekStart)}});
      closeModal('applyTplModal');
      await loadSessions();
      undoToast(`« ${tpl.name} » appliqué`, () => {
        res.sessions.forEach(s => deleteRecord('sessions', s.id));
      });
    };
    list.appendChild(btn);
  });
  openModal('applyTplModal');
};
document.getElementById('closeApplyTplBtn').onclick = () => closeModal('applyTplModal');
document.getElementById('applyTplCreateBtn').onclick = () => {
  closeModal('applyTplModal');
  showPage('templates');
  openNewTemplate();
};
