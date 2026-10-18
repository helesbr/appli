let sessions = [];
let templates = [];
let currentWeekStart = getMonday(new Date());
let editingSessionId = null;
let editingTplId = null;
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

document.querySelectorAll('.nav button').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + btn.dataset.page).classList.add('active');

    if (btn.dataset.page === 'topperf') await loadPerfs();
    if (btn.dataset.page === 'templates') await loadTemplates();
  });
});

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function frDate(str) {
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function frDateRange(start) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('fr-FR', opts)} — ${end.toLocaleDateString('fr-FR', opts)} ${end.getFullYear()}`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function closeModalById(id) {
  document.getElementById(id).classList.remove('open');
}

function renderWeek() {
  document.getElementById('weekLabel').textContent = frDateRange(currentWeekStart);
  const today = formatDate(new Date());

  for (let i = 0; i < 7; i++) {
    const cell = document.getElementById('d' + i);
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    const dateStr = formatDate(d);

    cell.className = 'day-cell' + (dateStr === today ? ' today' : '');
    cell.dataset.date = dateStr;

    const daySessions = sessions.filter(s => s.date === dateStr);
    cell.innerHTML = `<div class="day-num">${d.getDate()}</div>`;

    daySessions.forEach(s => {
      cell.innerHTML += `<div class="session-dot" data-id="${s.id}">${escapeHtml(s.name)}</div>`;
    });

    cell.onclick = (e) => {
      const dot = e.target.closest('.session-dot');
      if (dot) openEditSession(dot.dataset.id);
      else openNewSession(dateStr);
    };
  }
}

document.getElementById('prevWeek').onclick = () => {
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  renderWeek();
};

document.getElementById('nextWeek').onclick = () => {
  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  renderWeek();
};

function openNewSession(date) {
  editingSessionId = null;
  document.getElementById('modalTitle').textContent = 'Nouvelle Séance';
  document.getElementById('sessionDate').value = date || formatDate(new Date());
  document.getElementById('sessionName').value = '';
  document.getElementById('blockList').innerHTML = '';
  document.getElementById('deleteSessionBtn').style.display = 'none';
  addBlockUI('single');
  document.getElementById('sessionModal').classList.add('open');
}

function openEditSession(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  editingSessionId = id;
  document.getElementById('modalTitle').textContent = 'Modifier la Séance';
  document.getElementById('sessionDate').value = session.date;
  document.getElementById('sessionName').value = session.name;
  document.getElementById('blockList').innerHTML = '';
  document.getElementById('deleteSessionBtn').style.display = 'inline-block';

  if (session.blocks && session.blocks.length > 0) {
    session.blocks.forEach(b => addBlockUI(b.type, b.exercises));
  } else {
    addBlockUI('single');
  }

  document.getElementById('sessionModal').classList.add('open');
}

document.getElementById('addSessionBtn').onclick = () => openNewSession();
document.getElementById('closeModalBtn').onclick = () => closeModalById('sessionModal');
document.getElementById('addSingleBtn').onclick = () => addBlockUI('single');
document.getElementById('addSupersetBtn').onclick = () => addBlockUI('superset');

function addBlockUI(type, exercises) {
  const wrapper = document.createElement('div');
  wrapper.className = 'block-wrapper ' + type;
  wrapper.dataset.type = type;

  const header = document.createElement('div');
  header.className = 'block-header';

  if (type === 'superset') {
    const addExoBtn = document.createElement('button');
    addExoBtn.className = 'btn btn-secondary btn-sm';
    addExoBtn.textContent = '+ Exo au superset';
    addExoBtn.onclick = () => addExoToBlock(wrapper);
    header.appendChild(addExoBtn);
  }

  const removeBlockBtn = document.createElement('button');
  removeBlockBtn.className = 'btn btn-danger btn-sm';
  removeBlockBtn.textContent = '✕ Bloc';
  removeBlockBtn.onclick = () => wrapper.remove();
  header.appendChild(removeBlockBtn);

  wrapper.appendChild(header);

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

function addExoToBlock(wrapper, ex) {
  const container = wrapper.querySelector('.exo-container');
  const div = document.createElement('div');
  div.className = 'exercise-block';
  const sets = ex ? (ex.sets || [{ reps: '', weight: '' }]) : [{ reps: '', weight: '' }];

  div.innerHTML = `
    <div class="exo-header">
      <input type="text" class="exo-name" placeholder="Nom de l'exercice" value="${ex ? escapeHtml(ex.name) : ''}" maxlength="200">
      <div style="display:flex;align-items:center;gap:3px;flex-shrink:0;">
        <span style="font-size:0.75rem;">⏱</span>
        <input type="number" class="exo-rest" placeholder="-" value="${ex && ex.rest ? ex.rest : ''}" min="0" max="3600" style="width:50px;padding:5px;text-align:center;border:2px solid #16213e;border-radius:6px;background:#16213e;color:#eee;font-size:0.8rem;outline:none;">
        <span style="color:#888;font-size:0.7rem;">s</span>
      </div>
      <button class="btn btn-danger btn-sm remove-exo">✕</button>
    </div>
    <table class="sets-table">
      <thead>
        <tr><th>Série</th><th>Reps</th><th>Poids (kg)</th><th></th></tr>
      </thead>
      <tbody>
        ${sets.map((s, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><input type="number" class="set-reps" value="${s.reps}" min="0" max="9999"></td>
            <td><input type="number" class="set-weight" value="${s.weight}" min="0" max="9999" step="0.5"></td>
            <td><button class="btn btn-danger btn-sm remove-set">✕</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="btn btn-secondary btn-sm add-set" style="margin-top:6px;">+ Série</button>
  `;

  div.querySelector('.remove-exo').onclick = () => div.remove();

  div.querySelector('.add-set').onclick = () => {
    const tbody = div.querySelector('tbody');
    const idx = tbody.rows.length + 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx}</td>
      <td><input type="number" class="set-reps" min="0" max="9999"></td>
      <td><input type="number" class="set-weight" min="0" max="9999" step="0.5"></td>
      <td><button class="btn btn-danger btn-sm remove-set">✕</button></td>
    `;
    tr.querySelector('.remove-set').onclick = () => {
      tr.remove();
      renumberSets(div);
    };
    tbody.appendChild(tr);
  };

  div.querySelectorAll('.remove-set').forEach(btn => {
    btn.onclick = () => {
      btn.closest('tr').remove();
      renumberSets(div);
    };
  });

  container.appendChild(div);
}

function renumberSets(div) {
  div.querySelectorAll('tbody tr').forEach((tr, i) => {
    tr.cells[0].textContent = i + 1;
  });
}

document.getElementById('saveSessionBtn').onclick = async () => {
  try {
    const date = document.getElementById('sessionDate').value;
    const name = document.getElementById('sessionName').value.trim();
    if (!date || !name) return alert('Remplis la date et le nom');

    const blocks = [];
    document.querySelectorAll('#blockList .block-wrapper').forEach(wrapper => {
      const type = wrapper.dataset.type;
      const exercises = [];

      wrapper.querySelectorAll('.exercise-block').forEach(block => {
        const exName = block.querySelector('.exo-name').value.trim();
        if (!exName) return;

        const sets = [];
        block.querySelectorAll('tbody tr').forEach(tr => {
          const reps = tr.querySelector('.set-reps').value;
          const weight = tr.querySelector('.set-weight').value;
          sets.push({
            reps: reps || 0,
            weight: weight || 0
          });
        });

        const rest = parseInt(block.querySelector('.exo-rest').value) || 0;
        exercises.push({ name: exName, sets, rest });
      });

      if (exercises.length > 0) blocks.push({ type, exercises });
    });

    const body = { date, name, blocks };

    let res;
    if (editingSessionId) {
      res = await fetch('/api/sessions/' + editingSessionId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
      throw new Error(err.error || 'Erreur lors de la sauvegarde');
    }

    closeModalById('sessionModal');
    await loadSessions();
  } catch (err) {
    console.error('saveSession:', err);
    alert(err.message || 'Erreur lors de la sauvegarde');
  }
};

document.getElementById('deleteSessionBtn').onclick = async () => {
  try {
    if (!editingSessionId || !confirm('Supprimer cette séance ?')) return;

    const res = await fetch('/api/sessions/' + editingSessionId, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur suppression' }));
      throw new Error(err.error || 'Erreur lors de la suppression');
    }

    closeModalById('sessionModal');
    await loadSessions();
  } catch (err) {
    console.error('deleteSession:', err);
    alert(err.message || 'Erreur lors de la suppression');
  }
};

async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    if (!res.ok) throw new Error('Erreur API templates: ' + res.status);
    templates = await res.json();
    renderTemplates();
  } catch (err) {
    console.error('loadTemplates:', err);
    templates = [];
    renderTemplates();
  }
}

function renderTemplates() {
  const list = document.getElementById('tplList');
  const empty = document.getElementById('tplEmpty');
  list.innerHTML = '';
  empty.style.display = templates.length === 0 ? 'block' : 'none';

  templates.forEach(tpl => {
    const div = document.createElement('div');
    div.className = 'tpl-card';
    const sessionsInfo = (tpl.sessions || []).map(s => `<span class="tpl-day-label">${DAYS[s.dayOfWeek - 1]}: ${escapeHtml(s.name)}</span>`).join(' ');
    div.innerHTML = `
      <div class="tpl-card-header">
        <span class="tpl-card-name">${escapeHtml(tpl.name)}</span>
        <span class="tpl-card-type">${escapeHtml(tpl.weekType || '')}</span>
      </div>
      <div class="tpl-card-sessions">${sessionsInfo || 'Aucune séance'}</div>
    `;
    div.onclick = () => openEditTemplate(tpl.id);
    list.appendChild(div);
  });
}

document.getElementById('addTplBtn').onclick = () => openNewTemplate();
document.getElementById('closeTplModalBtn').onclick = () => closeModalById('tplModal');

function openNewTemplate() {
  editingTplId = null;
  document.getElementById('tplModalTitle').textContent = 'Nouveau Template';
  document.getElementById('tplName').value = '';
  document.getElementById('tplWeekType').value = '';
  document.getElementById('tplSessionList').innerHTML = '';
  document.getElementById('deleteTplBtn').style.display = 'none';
  addTplSessionUI();
  document.getElementById('tplModal').classList.add('open');
}

function openEditTemplate(id) {
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;

  editingTplId = id;
  document.getElementById('tplModalTitle').textContent = 'Modifier le Template';
  document.getElementById('tplName').value = tpl.name;
  document.getElementById('tplWeekType').value = tpl.weekType || '';
  document.getElementById('tplSessionList').innerHTML = '';
  document.getElementById('deleteTplBtn').style.display = 'inline-block';

  if (tpl.sessions && tpl.sessions.length > 0) {
    tpl.sessions.forEach(s => addTplSessionUI(s));
  } else {
    addTplSessionUI();
  }

  document.getElementById('tplModal').classList.add('open');
}

document.getElementById('addTplSessionBtn').onclick = () => addTplSessionUI();

function addTplSessionUI(s) {
  const div = document.createElement('div');
  div.style.cssText = 'background:#1a1a2e;border-radius:8px;padding:12px;margin-bottom:10px;';
  const dayOptions = DAYS.map((d, i) => `<option value="${i + 1}" ${s && s.dayOfWeek === i + 1 ? 'selected' : ''}>${d}</option>`).join('');

  div.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap;">
      <select class="tpl-day" style="padding:8px;border-radius:8px;background:#16213e;color:#eee;border:2px solid #16213e;font-size:0.9rem;">${dayOptions}</select>
      <input type="text" class="tpl-session-name" placeholder="Nom (Push, Pull...)" value="${s ? escapeHtml(s.name) : ''}" maxlength="200" style="flex:1;min-width:120px;padding:8px 10px;border:2px solid #16213e;border-radius:8px;background:#16213e;color:#eee;font-size:0.9rem;outline:none;">
      <button class="btn btn-danger btn-sm remove-tpl-session">✕</button>
    </div>
    <div class="tpl-blocks"></div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
      <button class="btn btn-secondary btn-sm add-tpl-single">+ Exercice</button>
      <button class="btn btn-secondary btn-sm add-tpl-superset">⚡ + Superset</button>
    </div>
  `;

  div.querySelector('.remove-tpl-session').onclick = () => div.remove();
  div.querySelector('.add-tpl-single').onclick = () => addTplBlockUI(div.querySelector('.tpl-blocks'), 'single');
  div.querySelector('.add-tpl-superset').onclick = () => addTplBlockUI(div.querySelector('.tpl-blocks'), 'superset');

  const blocksContainer = div.querySelector('.tpl-blocks');
  if (s && s.blocks && s.blocks.length > 0) {
    s.blocks.forEach(b => addTplBlockUI(blocksContainer, b.type, b.exercises));
  } else {
    addTplBlockUI(blocksContainer, 'single');
  }

  document.getElementById('tplSessionList').appendChild(div);
}

function addTplBlockUI(container, type, exercises) {
  const bDiv = document.createElement('div');
  bDiv.className = 'block-wrapper ' + type;
  bDiv.dataset.type = type;
  bDiv.style.marginBottom = '8px';

  const bHeader = document.createElement('div');
  bHeader.className = 'block-header';

  if (type === 'superset') {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary btn-sm';
    addBtn.textContent = '+ Exo';
    addBtn.onclick = () => addTplExoUI(bDiv.querySelector('.tpl-exo-container'));
    bHeader.appendChild(addBtn);
  }

  const rmBtn = document.createElement('button');
  rmBtn.className = 'btn btn-danger btn-sm';
  rmBtn.textContent = '✕';
  rmBtn.onclick = () => bDiv.remove();
  bHeader.appendChild(rmBtn);

  bDiv.appendChild(bHeader);

  const exoC = document.createElement('div');
  exoC.className = 'tpl-exo-container';
  bDiv.appendChild(exoC);

  if (exercises && exercises.length > 0) {
    exercises.forEach(ex => addTplExoUI(exoC, ex));
  } else {
    addTplExoUI(exoC);
    if (type === 'superset') addTplExoUI(exoC);
  }

  container.appendChild(bDiv);
}

function addTplExoUI(container, ex) {
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;flex-wrap:wrap;';
  div.innerHTML = `
    <input type="text" class="tpl-exo-name" placeholder="Exercice" value="${ex ? escapeHtml(ex.name) : ''}" maxlength="200" style="flex:1;min-width:120px;padding:6px 8px;border:2px solid #16213e;border-radius:6px;background:#16213e;color:#eee;font-size:0.85rem;outline:none;">
    <input type="number" class="tpl-exo-sets" placeholder="Séries" value="${ex ? ex.setsCount : 4}" min="1" max="20" style="width:50px;padding:6px;text-align:center;border:2px solid #16213e;border-radius:6px;background:#16213e;color:#eee;font-size:0.85rem;outline:none;">
    <span style="color:#888;font-size:0.75rem;">séries</span>
    <span style="font-size:0.75rem;">⏱</span>
    <input type="number" class="tpl-exo-rest" placeholder="-" value="${ex && ex.rest ? ex.rest : ''}" min="0" max="3600" style="width:45px;padding:6px;text-align:center;border:2px solid #16213e;border-radius:6px;background:#16213e;color:#eee;font-size:0.85rem;outline:none;">
    <span style="color:#888;font-size:0.75rem;">s</span>
    <button class="btn btn-danger btn-sm" style="padding:4px 8px;">✕</button>
  `;
  div.querySelector('button').onclick = () => div.remove();
  container.appendChild(div);
}

document.getElementById('saveTplBtn').onclick = async () => {
  try {
    const name = document.getElementById('tplName').value.trim();
    const weekType = document.getElementById('tplWeekType').value.trim();

    if (!name) return alert('Donne un nom au template');

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
          const setsCount = parseInt(exDiv.querySelector('.tpl-exo-sets').value) || 4;
          const rest = parseInt(exDiv.querySelector('.tpl-exo-rest').value) || 0;
          if (eName) exercises.push({ name: eName, setsCount, rest });
        });

        if (exercises.length > 0) blocks.push({ type, exercises });
      });

      tplSessions.push({ name: sName, dayOfWeek, blocks });
    });

    const body = { name, weekType, sessions: tplSessions };

    let res;
    if (editingTplId) {
      res = await fetch('/api/templates/' + editingTplId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur template' }));
      throw new Error(err.error || 'Erreur lors de la sauvegarde du template');
    }

    closeModalById('tplModal');
    await loadTemplates();
  } catch (err) {
    console.error('saveTpl:', err);
    alert(err.message || 'Erreur lors de la sauvegarde du template');
  }
};

document.getElementById('deleteTplBtn').onclick = async () => {
  try {
    if (!editingTplId || !confirm('Supprimer ce template ?')) return;

    const res = await fetch('/api/templates/' + editingTplId, {
      method: 'DELETE'
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur suppression template' }));
      throw new Error(err.error || 'Erreur lors de la suppression du template');
    }

    closeModalById('tplModal');
    await loadTemplates();
  } catch (err) {
    console.error('deleteTpl:', err);
    alert(err.message || 'Erreur lors de la suppression du template');
  }
};

document.getElementById('applyTplBtn').onclick = async () => {
  try {
    await loadTemplates();

    const list = document.getElementById('applyTplList');
    const empty = document.getElementById('applyTplEmpty');
    list.innerHTML = '';
    empty.style.display = templates.length === 0 ? 'block' : 'none';

    templates.forEach(tpl => {
      const btn = document.createElement('div');
      btn.className = 'tpl-card';
      btn.innerHTML = `
        <div class="tpl-card-header">
          <span class="tpl-card-name">${escapeHtml(tpl.name)}</span>
          <span class="tpl-card-type">${escapeHtml(tpl.weekType || '')}</span>
        </div>
        <div class="tpl-card-sessions">
          ${(tpl.sessions || []).map(s => `<span class="tpl-day-label">${DAYS[s.dayOfWeek - 1]}: ${escapeHtml(s.name)}</span>`).join(' ')}
        </div>
      `;

      btn.onclick = async () => {
        try {
          if (!confirm(`Appliquer "${tpl.name}" à la semaine du ${frDateRange(currentWeekStart)} ?`)) return;

          const res = await fetch('/api/templates/' + tpl.id + '/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekStart: formatDate(currentWeekStart) })
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Erreur application template' }));
            throw new Error(err.error || 'Erreur lors de l’application du template');
          }

          closeModalById('applyTplModal');
          await loadSessions();
        } catch (err) {
          console.error('applyTemplate:', err);
          alert(err.message || 'Erreur lors de l’application du template');
        }
      };

      list.appendChild(btn);
    });

    document.getElementById('applyTplModal').classList.add('open');
  } catch (err) {
    console.error('openApplyTplModal:', err);
    alert('Impossible de charger les templates');
  }
};

document.getElementById('closeApplyTplBtn').onclick = () => closeModalById('applyTplModal');

async function loadPerfs() {
  try {
    const res = await fetch('/api/top-perfs');
    if (!res.ok) throw new Error('Erreur API perfs: ' + res.status);

    const perfs = await res.json();
    const list = document.getElementById('perfList');
    const empty = document.getElementById('perfEmpty');

    list.innerHTML = '';
    empty.style.display = perfs.length === 0 ? 'block' : 'none';

    perfs.forEach(p => {
      const div = document.createElement('div');
      div.className = 'perf-card';
      div.innerHTML = `
        <div>
          <div class="perf-exo">${escapeHtml(p.exercise)}</div>
          <div class="perf-detail">${frDate(p.date)} · ${escapeHtml(p.sessionName)}</div>
        </div>
        <div class="perf-value">${p.weight} kg × ${p.reps}</div>
      `;
      div.onclick = () => showSessionDetail(p.sessionId);
      list.appendChild(div);
    });
  } catch (err) {
    console.error('loadPerfs:', err);
  }
}

async function showSessionDetail(id) {
  try {
    const res = await fetch('/api/sessions/' + id);
    if (!res.ok) return alert('Séance introuvable');

    const s = await res.json();
    document.getElementById('detailTitle').textContent = s.name;
    document.getElementById('detailDate').textContent = frDate(s.date);

    const container = document.getElementById('detailExercises');
    container.innerHTML = '';

    (s.blocks || []).forEach(block => {
      const bDiv = document.createElement('div');

      if (block.type === 'superset') {
        bDiv.className = 'block-wrapper superset';
        bDiv.style.marginBottom = '10px';
      }

      (block.exercises || []).forEach(ex => {
        const div = document.createElement('div');
        div.className = 'session-detail-exo';
        div.innerHTML = `
          <h4>${escapeHtml(ex.name)}${ex.rest ? ` <span style="color:#888;font-size:0.8rem;">⏱ ${ex.rest}s repos</span>` : ''}</h4>
          <table>
            <thead><tr><th>Série</th><th>Reps</th><th>Poids</th></tr></thead>
            <tbody>
              ${(ex.sets || []).map((set, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${set.reps}</td>
                  <td>${set.weight} kg</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        bDiv.appendChild(div);
      });

      container.appendChild(bDiv);
    });

    document.getElementById('detailModal').classList.add('open');
  } catch (err) {
    console.error('showSessionDetail:', err);
    alert('Erreur lors du chargement de la séance');
  }
}

document.getElementById('closeDetailBtn').onclick = () => closeModalById('detailModal');

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error('Erreur API sessions: ' + res.status);
    sessions = await res.json();
    renderWeek();
  } catch (err) {
    console.error('loadSessions:', err);
    sessions = [];
    renderWeek();
  }
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

loadSessions();
loadTemplates();
setInterval(loadSessions, 5000);
