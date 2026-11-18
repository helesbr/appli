// Records et détail d'une séance
async function loadPerfs() {
  if (perfKind === 'run') renderRunPerfs();
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
    div.onclick = () => showExercisePodium(p);
    list.appendChild(div);
  });
}
document.getElementById('perfSearch').addEventListener('input', renderPerfs);

// Bloc d'un exercice (repos, note, séries) ; bestIndex : série mise en évidence
function exerciseDetailHTML(ex, bestIndex = -1) {
  return `<h4><span>${escapeHtml(ex.name)}</span>${ex.rest?`<span class="rest-pill">${icon('timer')}${escapeHtml(ex.rest)}s</span>`:''}</h4>
    ${ex.note?`<p class="detail-note">${escapeHtml(ex.note)}</p>`:''}
    <table><thead><tr><th>Série</th><th>Reps</th><th>Poids</th></tr></thead>
    <tbody>${(ex.sets||[]).map((set,i)=>`<tr${i===bestIndex?' class="best-set"':''}><td>${i+1}</td><td>${escapeHtml(set.reps)}</td><td>${escapeHtml(set.weight)} kg</td></tr>`).join('')}</tbody></table>`;
}

// Fiche d'un exercice : ses 3 meilleures séances, avec seulement le bloc de cet exercice
const PODIUM_MEDALS = ['🥇', '🥈', '🥉'];
function showExercisePodium(perf) {
  const podium = perf.podium && perf.podium.length ? perf.podium : [perf];
  document.getElementById('detailTitle').textContent = perf.exercise;
  document.getElementById('detailDate').textContent = podium.length > 1 ? `Tes ${podium.length} meilleures séances` : 'Ta meilleure séance';
  document.getElementById('detailStats').innerHTML = '';
  const container = document.getElementById('detailExercises');
  container.innerHTML = podium.map((p, rank) => {
    const session = sessions.find(s => s.id === p.sessionId);
    const blocks = session ? exerciseInSession(session, perf.exercise, p) : [];
    const w = num(p.weight), r = num(p.reps);
    const oneRm = r > 1 && w > 0 ? ` · 1RM ≈ ${Math.round(w * (1 + r / 30))}` : '';
    return `<div class="podium-entry">
      <div class="podium-head">
        <span class="podium-rank" aria-label="${rank + 1}e">${PODIUM_MEDALS[rank]}</span>
        <div class="podium-info">
          <b>${escapeHtml(p.weight)} kg × ${escapeHtml(p.reps)}</b><span class="perf-1rm">${oneRm}</span>
          <span class="podium-when">${frDate(p.date)} · ${escapeHtml(p.sessionName)}</span>
        </div>
        <button class="btn btn-secondary btn-sm" data-session="${escapeHtml(p.sessionId)}">Séance</button>
      </div>
      ${blocks.map(b => `<div class="session-detail-exo${b.superset ? ' in-superset' : ''}">${b.superset ? `<span class="block-tag">${icon('zap')}Superset</span>` : ''}${exerciseDetailHTML(b.exercise, b.bestIndex)}</div>`).join('')}
    </div>`;
  }).join('');
  container.onclick = e => {
    const btn = e.target.closest('[data-session]');
    if (btn) showSessionDetail(btn.dataset.session);
  };
  openModal('detailModal');
}

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
  container.onclick = null;
  (s.blocks||[]).forEach(block => {
    const bDiv = document.createElement('div');
    if (block.type==='superset') {
      bDiv.className = 'block-wrapper superset';
      bDiv.innerHTML = `<div class="block-header"><span class="block-tag">${icon('zap')}Superset</span></div>`;
    }
    (block.exercises||[]).forEach(ex => {
      const div = document.createElement('div');
      div.className = 'session-detail-exo';
      div.innerHTML = exerciseDetailHTML(ex);
      bDiv.appendChild(div);
    });
    container.appendChild(bDiv);
  });
  openModal('detailModal');
}
document.getElementById('closeDetailBtn').onclick = () => closeModal('detailModal');
document.getElementById('perfEmptyBtn').onclick = () => showPage('calendar');

// --- RECORDS DE COURSE ---
// Calculés sur les séances déjà chargées : disponibles aussi hors connexion
let perfKind = 'gym';

function runRecordHTML(iconName, label, session, value, detail = session.name, note = '') {
  return `<div class="run-record card" role="button" tabindex="0" data-run="${escapeHtml(session.id)}">
    <div class="perf-avatar">${icon(iconName)}</div>
    <div class="perf-info">
      <div class="perf-exo">${label}</div>
      <div class="perf-detail">${frDate(session.date)} · ${escapeHtml(detail)}${note ? ` · ${note}` : ''}</div>
    </div>
    <div class="perf-value"><div class="perf-weight">${value}</div></div>
  </div>`;
}

function renderRunPerfs() {
  const r = runRecords(sessions, formatDate(new Date()));
  document.getElementById('runWeekKm').innerHTML = `${formatKm(r.weekKm)}<small>km</small>`;
  document.getElementById('runMonthKm').innerHTML = `${formatKm(r.monthKm)}<small>km</small>`;
  document.getElementById('runYearKm').innerHTML = `${formatKm(r.yearKm)}<small>km</small>`;
  const records = [];
  if (r.longest) records.push(runRecordHTML('run', 'Plus longue sortie', r.longest, `${formatKm(r.longest.run.distanceKm)}<small>km</small>`));
  if (r.fastest) records.push(runRecordHTML('gauge', 'Meilleure allure', r.fastest, `${formatPace(paceSeconds(r.fastest.run.distanceKm, r.fastest.run.durationSec))}<small>/km</small>`, r.fastest.name, 'sur 3 km et +'));
  if (r.climb) records.push(runRecordHTML('mountain', 'Plus gros dénivelé', r.climb, `${Math.round(r.climb.run.elevation)}<small>m</small>`));
  document.getElementById('runRecordList').innerHTML = records.join('');
  // Records sur distance, calculés par Strava à l'intérieur de chaque course
  const efforts = bestEffortRecords(sessions);
  document.getElementById('runEffortTitle').hidden = efforts.length === 0;
  document.getElementById('runEffortList').innerHTML = efforts
    .map(e => runRecordHTML('trophy', `Meilleur ${e.label}`, e.session, formatDuration(e.sec))).join('');
  document.getElementById('runRecentList').innerHTML = r.recent
    .map(s => runRecordHTML('run', escapeHtml(s.name), s, `${formatKm(s.run.distanceKm)}<small>km</small>`, runSummary(s.run))).join('');
  document.getElementById('runRecentTitle').hidden = r.recent.length === 0;
  document.getElementById('runEmpty').hidden = r.recent.length > 0;
}

function setPerfKind(kind) {
  perfKind = kind;
  document.querySelectorAll('#perfKindSwitch button').forEach(b => {
    b.classList.toggle('active', b.dataset.kind === kind);
    b.setAttribute('aria-pressed', b.dataset.kind === kind);
  });
  document.getElementById('perfGym').hidden = kind === 'run';
  document.getElementById('perfRun').hidden = kind !== 'run';
  if (kind === 'run') renderRunPerfs();
}
document.getElementById('perfKindSwitch').onclick = e => {
  const btn = e.target.closest('[data-kind]');
  if (btn) setPerfKind(btn.dataset.kind);
};
document.getElementById('perfRun').onclick = e => {
  const card = e.target.closest('[data-run]');
  if (card) openEditRun(card.dataset.run);
};
