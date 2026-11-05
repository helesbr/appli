// Records et détail d'une séance
async function loadPerfs() {
  const data = await api('/api/top-perfs');
  perfs = Array.isArray(data) ? data : [];
  renderPerfs();
}

function renderPerfs() {
  const q = document.getElementById('perfSearch').value.trim().toLowerCase();
  const filtered = perfs.filter(p => exerciseKey(p.exercise).includes(exerciseKey(q)));
  const list = document.getElementById('perfList');
  const empty = document.getElementById('perfEmpty');
  list.innerHTML = '';
  empty.style.display = perfs.length===0?'block':'none';
  const noResult = document.getElementById('perfNoResult');
  noResult.hidden = perfs.length === 0 || filtered.length > 0;
  noResult.textContent = `Aucun exercice ne correspond à « ${document.getElementById('perfSearch').value.trim()} ».`;
  filtered.forEach(p => {
    const w = num(p.weight), r = num(p.reps);
    // Epley estimate of the one-rep max
    const oneRm = r > 1 && w > 0 ? Math.round(w * (1 + r/30)) : null;
    const div = document.createElement('div');
    div.className = 'perf-card card';
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    div.innerHTML = `
      <div class="perf-avatar">${escapeHtml(p.exercise.trim().charAt(0).toUpperCase())}</div>
      <div class="perf-info">
        <div class="perf-exo">${escapeHtml(p.exercise)}</div>
        <div class="perf-detail">${frDate(p.date)} · ${escapeHtml(p.sessionName)}</div>
      </div>
      <div class="perf-value">
        <div class="perf-weight">${escapeHtml(p.weight)}<small>kg</small></div>
        <div class="perf-reps">× ${escapeHtml(p.reps)}${oneRm ? ` <span class="perf-1rm">· 1RM ≈ ${oneRm}</span>` : ''}</div>
      </div>`;
    div.onclick = () => showSessionDetail(p.sessionId);
    list.appendChild(div);
  });
}
document.getElementById('perfSearch').addEventListener('input', renderPerfs);

async function showSessionDetail(id) {
  // Déjà en mémoire la plupart du temps : fonctionne aussi hors connexion
  const s = sessions.find(x => x.id === id) || await api('/api/sessions/'+id);
  document.getElementById('detailTitle').textContent = s.name;
  document.getElementById('detailDate').textContent = frLongDate(s.date);
  const st = sessionStats(s);
  document.getElementById('detailStats').innerHTML = `
    <div class="stat"><div class="stat-label">Exos</div><div class="stat-value">${st.exos}</div></div>
    <div class="stat"><div class="stat-label">Séries</div><div class="stat-value">${st.sets}</div></div>
    <div class="stat"><div class="stat-label">Volume</div><div class="stat-value">${formatVolume(st.volume)}</div></div>`;
  const container = document.getElementById('detailExercises');
  container.innerHTML = '';
  (s.blocks||[]).forEach(block => {
    const bDiv = document.createElement('div');
    if (block.type==='superset') {
      bDiv.className = 'block-wrapper superset';
      bDiv.innerHTML = `<div class="block-header"><span class="block-tag">${icon('zap')}Superset</span></div>`;
    }
    (block.exercises||[]).forEach(ex => {
      const div = document.createElement('div');
      div.className = 'session-detail-exo';
      div.innerHTML = `<h4><span>${escapeHtml(ex.name)}</span>${ex.rest?`<span class="rest-pill">${icon('timer')}${escapeHtml(ex.rest)}s</span>`:''}</h4>
        <table><thead><tr><th>Série</th><th>Reps</th><th>Poids</th></tr></thead>
        <tbody>${(ex.sets||[]).map((set,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(set.reps)}</td><td>${escapeHtml(set.weight)} kg</td></tr>`).join('')}</tbody></table>`;
      bDiv.appendChild(div);
    });
    container.appendChild(bDiv);
  });
  openModal('detailModal');
}
document.getElementById('closeDetailBtn').onclick = () => closeModal('detailModal');
document.getElementById('perfEmptyBtn').onclick = () => showPage('calendar');
