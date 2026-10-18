// --- STATE ---
let sessions = [];
let templates = [];
let perfs = [];
let currentWeekStart = getMonday(new Date());
let editingSessionId = null;
let editingTplId = null;
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const DAYS_SHORT = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const DAYS_LETTER = ['L','M','M','J','V','S','D'];

// --- API & CONNEXION ---
const TOKEN_KEY = 'moggtrack-token';
function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

async function api(url, opts = {}) {
  const headers = { 'Authorization': 'Bearer ' + (getToken() || '') };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new Error('Pas de connexion : réessaie quand tu seras en ligne');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.code === 'NO_PASSWORD') {
    showLogin(data.code === 'NO_PASSWORD' ? data.error : 'Session expirée, reconnecte-toi');
    const err = new Error(data.error || 'Non autorisé');
    err.silent = true;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}
// Les erreurs des actions (sauvegarde, suppression…) s'affichent en toast
window.addEventListener('unhandledrejection', e => {
  if (e.reason && e.reason.silent) return;
  toast((e.reason && e.reason.message) || 'Une erreur est survenue', 'error');
});

let pollTimer = null;
function startApp() {
  document.getElementById('loginScreen').hidden = true;
  loadSessions();
  loadTemplates();
  if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden) loadSessions().catch(() => {}); }, 5000);
}
function showLogin(message) {
  setToken(null);
  clearInterval(pollTimer); pollTimer = null;
  sessions = []; templates = []; perfs = [];
  if ('caches' in window) caches.delete('moggtrack-api').catch(() => {});
  document.querySelectorAll('.modal-overlay.open').forEach(o => closeModal(o.id));
  const err = document.getElementById('loginError');
  err.textContent = message || '';
  err.hidden = !message;
  document.getElementById('loginScreen').hidden = false;
  setTimeout(() => document.getElementById('loginPassword').focus(), 50);
}
document.getElementById('loginForm').onsubmit = async e => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const input = document.getElementById('loginPassword');
  const err = document.getElementById('loginError');
  btn.disabled = true; btn.textContent = 'Connexion…'; err.hidden = true;
  try {
    let res;
    try {
      res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
    } catch (e) { throw new Error('Pas de connexion internet'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Connexion impossible');
    setToken(data.token);
    input.value = '';
    startApp();
    toast('Connecté');
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
    input.select();
  } finally {
    btn.disabled = false; btn.textContent = 'Se connecter';
  }
};
document.getElementById('logoutBtn').onclick = () => {
  if (!confirm('Se déconnecter de cet appareil ?')) return;
  showLogin();
  renderWeek();
};
window.addEventListener('offline', () => toast('Hors connexion : les modifications ne seront pas enregistrées', 'error'));
window.addEventListener('online', () => { toast('De nouveau en ligne'); if (getToken()) loadSessions().catch(() => {}); });

// --- UTILS ---
function icon(name, cls) { return `<svg class="ic ${cls||''}"><use href="#i-${name}"/></svg>`; }
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0,0,0,0);
  return date;
}
function getWeekNumber(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}
function formatDate(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function frDate(str) { const [y,m,d]=str.split('-'); return `${d}/${m}/${y}`; }
function frLongDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function frDateRange(start) {
  const end = new Date(start); end.setDate(end.getDate()+6);
  const opts = { day:'numeric', month:'short' };
  return `${start.toLocaleDateString('fr-FR',opts)} — ${end.toLocaleDateString('fr-FR',opts)} ${end.getFullYear()}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
const blankZero = v => (v === '' || v == null || Number(v) === 0) ? '' : v;
function sessionStats(s) {
  let exos = 0, sets = 0, volume = 0;
  (s.blocks||[]).forEach(b => (b.exercises||[]).forEach(ex => {
    exos++;
    (ex.sets||[]).forEach(set => { sets++; volume += num(set.reps) * num(set.weight); });
  }));
  return { exos, sets, volume };
}
function formatVolume(v) {
  if (v >= 1000) return `${(v/1000).toLocaleString('fr-FR',{maximumFractionDigits:1})}<small>t</small>`;
  return `${Math.round(v).toLocaleString('fr-FR')}<small>kg</small>`;
}
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type==='error' ? ' error' : '');
  el.innerHTML = icon(type==='error' ? 'alert' : 'check') + `<span>${escapeHtml(msg)}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2400);
}

// --- MODALS ---
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.classList.add('modal-open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeModal(overlay.id));
  if (overlay.hasAttribute('data-dismiss')) {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.modal-overlay.open')].pop();
  if (open) closeModal(open.id);
});

// --- NAV ---
document.querySelectorAll('.nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + btn.dataset.page).classList.add('active');
    window.scrollTo({ top: 0 });
    if (btn.dataset.page === 'topperf') loadPerfs();
    if (btn.dataset.page === 'templates') loadTemplates();
  });
});

document.getElementById('todayLabel').textContent =
  new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });

// --- CALENDAR ---
function renderWeek() {
  document.getElementById('weekLabel').textContent = frDateRange(currentWeekStart);
  const isCurrent = formatDate(currentWeekStart) === formatDate(getMonday(new Date()));
  document.getElementById('weekKicker').textContent = (isCurrent ? 'Cette semaine · ' : '') + 'Semaine ' + getWeekNumber(currentWeekStart);
  document.getElementById('todayBtn').hidden = isCurrent;

  const today = formatDate(new Date());
  let totalSessions = 0, doneSessions = 0;
  const weekTypes = {};
  for (let i=0;i<7;i++) {
    const cell = document.getElementById('d'+i);
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate()+i);
    const dateStr = formatDate(d);
    const daySessions = sessions.filter(s=>s.date===dateStr);
    cell.className = 'day-cell' + (dateStr===today?' today':'') + (dateStr<today?' past':'');
    cell.dataset.date = dateStr;
    const chips = daySessions.map(s => {
      const st = sessionStats(s);
      totalSessions++;
      if (s.weekType || s.templateName) {
        const k = JSON.stringify([s.weekType || '', s.templateName || '']);
        weekTypes[k] = (weekTypes[k] || 0) + 1;
      }
      if (s.completed) doneSessions++;
      return `<div class="session-dot${s.completed?' completed':''}" data-id="${escapeHtml(s.id)}">
        <div class="s-info">
          <span class="s-name">${escapeHtml(s.name)}</span>
          <span class="s-meta">${s.completed?'Terminée · ':''}${st.exos} exo${st.exos>1?'s':''} · ${st.sets} séries</span>
        </div>
        ${s.completed
          ? `<span class="s-done" title="Séance terminée">${icon('check','ic-sm')}</span>`
          : `<button class="chip-play" data-play="${escapeHtml(s.id)}" aria-label="Lancer la séance">${icon('play','ic-sm')}</button>`}
      </div>`;
    }).join('');
    cell.innerHTML = `
      <div class="day-meta"><span class="day-name">${DAYS_SHORT[i]}</span><span class="day-num">${d.getDate()}</span></div>
      <div class="day-body">${chips || `<span class="day-empty">${icon('plus')}Repos · ajouter une séance</span>`}</div>`;
    cell.onclick = (e) => {
      const play = e.target.closest('.chip-play');
      if (play) return openWorkout(play.dataset.play);
      const dot = e.target.closest('.session-dot');
      if (dot) openEditSession(dot.dataset.id);
      else openNewSession(dateStr);
    };
  }
  document.getElementById('statSessions').innerHTML = totalSessions ? `${doneSessions}<small>/${totalSessions}</small>` : '0';
  document.getElementById('statRing').style.strokeDashoffset = 100.53 * (1 - (totalSessions ? doneSessions / totalSessions : 0));
  renderHero();
  renderWeekType(weekTypes);
}
// Type de la semaine affichée : celui du template appliqué (le plus fréquent si plusieurs)
function renderWeekType(weekTypes) {
  const tile = document.getElementById('weekTypeTile');
  const best = Object.entries(weekTypes).sort((a, b) => b[1] - a[1])[0];
  if (best) {
    const [type, tplName] = JSON.parse(best[0]);
    document.getElementById('weekTypeValue').textContent = type || tplName;
    document.getElementById('weekTypeSub').textContent = type ? tplName : '';
    tile.classList.remove('empty-week');
  } else {
    document.getElementById('weekTypeValue').textContent = 'Libre';
    document.getElementById('weekTypeSub').textContent = '+ Appliquer un template';
    tile.classList.add('empty-week');
  }
}
document.getElementById('weekTypeTile').onclick = () => {
  if (document.getElementById('weekTypeTile').classList.contains('empty-week')) document.getElementById('applyTplBtn').click();
};

// Carte du jour : séance à lancer, séance faite, ou jour de repos
function renderHero() {
  const el = document.getElementById('heroCard');
  const today = formatDate(new Date());
  const todays = sessions.filter(s => s.date === today);
  const pending = todays.find(s => !s.completed);
  if (pending) {
    const st = sessionStats(pending);
    el.className = 'hero hero-go';
    el.innerHTML = `<div class="hero-kicker">Aujourd'hui</div>
      <div class="hero-title">${escapeHtml(pending.name)}</div>
      <div class="hero-meta">${st.exos} exercice${st.exos > 1 ? 's' : ''} · ${st.sets} séries</div>
      <button class="hero-btn" data-play="${escapeHtml(pending.id)}">${icon('play')}Lancer la séance</button>`;
  } else if (todays.length) {
    const st = todays.reduce((a, s) => { const x = sessionStats(s); return { sets: a.sets + x.sets, volume: a.volume + x.volume }; }, { sets: 0, volume: 0 });
    el.className = 'hero hero-done';
    el.innerHTML = `<div class="hero-kicker">Séance du jour terminée</div>
      <div class="hero-title">${todays.map(s => escapeHtml(s.name)).join(' + ')} 💪</div>
      <div class="hero-meta">${st.sets} séries · ${formatVolume(st.volume).replace(/<\/?small>/g, ' ').trim()} soulevés</div>`;
  } else {
    const next = sessions.filter(s => s.date > today && !s.completed).sort((a, b) => a.date.localeCompare(b.date))[0];
    el.className = 'hero hero-rest';
    el.innerHTML = `<div class="hero-kicker">Aujourd'hui</div>
      <div class="hero-title">Jour de repos</div>
      <div class="hero-meta">${next ? `Prochaine séance : <b>${escapeHtml(next.name)}</b> · ${frDay(next.date)}` : 'Aucune séance prévue : applique une semaine type.'}</div>`;
  }
}
document.getElementById('heroCard').onclick = e => {
  const play = e.target.closest('[data-play]');
  if (play) openWorkout(play.dataset.play);
};

document.getElementById('prevWeek').onclick = () => { currentWeekStart.setDate(currentWeekStart.getDate()-7); renderWeek(); };
document.getElementById('nextWeek').onclick = () => { currentWeekStart.setDate(currentWeekStart.getDate()+7); renderWeek(); };
document.getElementById('todayBtn').onclick = () => { currentWeekStart = getMonday(new Date()); renderWeek(); };

// ===========================================
// SESSION MODAL (with blocks: single/superset)
// ===========================================
function openNewSession(date) {
  editingSessionId = null;
  document.getElementById('modalTitle').textContent = 'Nouvelle séance';
  document.getElementById('sessionDate').value = date || formatDate(new Date());
  document.getElementById('sessionName').value = '';
  document.getElementById('blockList').innerHTML = '';
  document.getElementById('deleteSessionBtn').hidden = true;
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
  (session.blocks||[]).forEach(b => addBlockUI(b.type, b.exercises));
  openModal('sessionModal');
}
document.getElementById('addSessionBtn').onclick = () => openNewSession();
document.getElementById('closeModalBtn').onclick = () => closeModal('sessionModal');
document.getElementById('addSingleBtn').onclick = () => addBlockUI('single');
document.getElementById('addSupersetBtn').onclick = () => addBlockUI('superset');

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
    <td><input type="number" class="set-weight" inputmode="decimal" value="${s?escapeHtml(blankZero(s.weight)):''}" min="0" max="9999" step="0.5" placeholder="0"></td>
    <td><button class="icon-btn danger remove-set" aria-label="Supprimer la série">${icon('x','ic-sm')}</button></td>`;
}

function addExoToBlock(wrapper, ex) {
  const container = wrapper.querySelector('.exo-container');
  const div = document.createElement('div');
  div.className = 'exercise-block';
  const sets = ex ? ex.sets : [{reps:'',weight:''}];
  div.innerHTML = `
    <div class="exo-header">
      <input type="text" class="exo-name" placeholder="Nom de l'exercice" value="${ex?escapeHtml(ex.name):''}" maxlength="200">
      <label class="unit-input" title="Repos">${icon('timer')}<input type="number" class="exo-rest" inputmode="numeric" placeholder="–" value="${ex&&ex.rest?escapeHtml(ex.rest):''}" min="0" max="3600"><span>s</span></label>
      <button class="icon-btn danger remove-exo" aria-label="Supprimer l'exercice">${icon('trash','ic-sm')}</button>
    </div>
    <table class="sets-table">
      <thead><tr><th>#</th><th>Reps</th><th>Kg</th><th></th></tr></thead>
      <tbody>${sets.map((s,i)=>`<tr data-target="${escapeHtml(s.target||'')}" data-done="${s.done?'1':''}">${setRowHTML(i+1, s)}</tr>`).join('')}</tbody>
    </table>
    <button class="btn btn-ghost btn-sm add-set">${icon('plus','ic-sm')}Série</button>
  `;
  div.querySelector('.remove-exo').onclick = () => removeExoFrom(div, container);
  div.querySelector('.add-set').onclick = () => {
    const tbody=div.querySelector('tbody'); const idx=tbody.rows.length+1;
    const last = tbody.rows[tbody.rows.length-1];
    const prev = last ? { reps: last.querySelector('.set-reps').value, weight: last.querySelector('.set-weight').value, target: last.dataset.target } : null;
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
        const weight=tr.querySelector('.set-weight').value;
        sets.push({reps, weight, target: tr.dataset.target || '', done: tr.dataset.done === '1'});
      });
      const rest = parseInt(block.querySelector('.exo-rest').value) || 0;
      exercises.push({name:exName, sets, rest});
    });
    if (exercises.length>0) blocks.push({type, exercises});
  });
  return {date, name, blocks};
}
async function persistSessionForm() {
  const body = collectSessionForm();
  if (!body) return null;
  return editingSessionId
    ? api('/api/sessions/'+editingSessionId,{method:'PUT',body:body})
    : api('/api/sessions',{method:'POST',body:body});
}

document.getElementById('saveSessionBtn').onclick = async () => {
  if (!await persistSessionForm()) return;
  closeModal('sessionModal');
  toast('Séance enregistrée');
  await loadSessions();
};
document.getElementById('startWorkoutBtn').onclick = async () => {
  const saved = await persistSessionForm();
  if (!saved) return;
  closeModal('sessionModal');
  await loadSessions();
  openWorkout(saved.id);
};

document.getElementById('deleteSessionBtn').onclick = async () => {
  if (!editingSessionId||!confirm('Supprimer cette séance ?')) return;
  await api('/api/sessions/'+editingSessionId,{method:'DELETE'});
  closeModal('sessionModal');
  toast('Séance supprimée');
  await loadSessions();
};

// ===========================================
// MODE SÉANCE : remplir les charges à la salle
// ===========================================
const DEFAULT_REST = 90; // secondes, si l'exercice n'a pas de repos défini
let workout = null;      // copie de la séance en cours
let wkSaveTimer = null;

// Dernière fois où l'exercice a été fait (séries avec des données), avant cette séance
function lastPerformance(name, beforeDate, excludeId) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return null;
  let best = null;
  sessions.forEach(s => {
    if (s.id === excludeId || s.date > beforeDate) return;
    (s.blocks||[]).forEach(b => (b.exercises||[]).forEach(ex => {
      if ((ex.name||'').trim().toLowerCase() !== key) return;
      const sets = (ex.sets||[]).filter(st => num(st.weight) > 0 || num(st.reps) > 0);
      if (sets.length && (!best || s.date > best.date)) best = { date: s.date, sets };
    }));
  });
  return best;
}
function frDay(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
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
      const card = document.createElement('div');
      card.className = 'wk-exo';
      card.dataset.b = bi; card.dataset.e = ei;
      card.innerHTML = `
        <div class="wk-exo-head">
          <input class="wk-exo-name" data-field="name" value="${escapeHtml(ex.name)}" placeholder="Nom de l'exercice" maxlength="200">
          <button class="rest-pill" data-act="rest" title="Lancer le repos">${icon('timer')}${escapeHtml(parseInt(ex.rest) || DEFAULT_REST)}s</button>
          <button class="icon-btn danger" data-act="del-exo" aria-label="Retirer l'exercice">${icon('trash','ic-sm')}</button>
        </div>
        ${last ? `<div class="wk-last">${icon('history')}<span>Dernière fois (${frDate(last.date).slice(0,5)}) : ${last.sets.map(st => `<b>${escapeHtml(blankZero(st.weight)||0)}</b> kg × ${escapeHtml(blankZero(st.reps)||0)}`).join(' · ')}</span></div>` : ''}
        <div class="wk-sets-head"><span>#</span><span>Obj.</span><span>Reps</span><span>Kg</span><span>OK</span><span></span></div>
        ${ex.sets.map((st, si) => `
          <div class="wk-set${st.done ? ' done' : ''}" data-s="${si}">
            <span class="set-idx">${si + 1}</span>
            <span class="wk-target">${st.target ? escapeHtml(st.target) : '–'}</span>
            <input type="number" inputmode="numeric" data-field="reps" min="0" max="9999" value="${escapeHtml(blankZero(st.reps))}" placeholder="${escapeHtml(st.target || '0')}" aria-label="Reps">
            <input type="number" inputmode="decimal" step="0.5" min="0" max="9999" data-field="weight" value="${escapeHtml(blankZero(st.weight))}" placeholder="${escapeHtml(last && last.sets[si] ? blankZero(last.sets[si].weight) || '0' : '0')}" aria-label="Charge en kg">
            <button class="wk-check" data-act="check" aria-label="Valider la série">${icon('check')}</button>
            <button class="icon-btn danger wk-del" data-act="del-set" aria-label="Supprimer la série">${icon('x','ic-sm')}</button>
          </div>`).join('')}
        <button class="btn btn-ghost btn-sm add-set" data-act="add-set">${icon('plus','ic-sm')}Série</button>`;
      bDiv.appendChild(card);
    });
    body.appendChild(bDiv);
  });
  if (!w.blocks.length) body.innerHTML = '<p class="empty">Aucun exercice. Ajoute-en un ci-dessous.</p>';
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
function scheduleWorkoutSave() {
  setWkStatus('Modifié…');
  clearTimeout(wkSaveTimer);
  wkSaveTimer = setTimeout(() => saveWorkout().catch(() => {}), 800);
}
async function saveWorkout() {
  clearTimeout(wkSaveTimer);
  wkSaveTimer = null;
  if (!workout) return;
  const w = workout;
  const body = { date: w.date, name: w.name, blocks: w.blocks, completed: !!w.completed };
  setWkStatus('Enregistrement…');
  try {
    await api('/api/sessions/' + w.id, { method: 'PUT', body });
    const i = sessions.findIndex(s => s.id === w.id);
    if (i >= 0) sessions[i] = { ...sessions[i], ...JSON.parse(JSON.stringify(body)) };
    if (workout === w) setWkStatus('Enregistré ✓');
  } catch (e) {
    if (workout === w) setWkStatus('Non enregistré', true);
    throw e;
  }
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
const wkBody = document.getElementById('wkBody');
wkBody.addEventListener('input', e => {
  const field = e.target.dataset.field;
  if (!field || !workout) return;
  const t = wkLocate(e.target);
  if (field === 'name') t.ex.name = e.target.value;
  else t.set[field] = e.target.value;
  scheduleWorkoutSave();
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
    t.ex.sets.splice(t.si, 1);
  } else if (act === 'add-set') {
    const prev = t.ex.sets[t.ex.sets.length - 1];
    t.ex.sets.push({ reps: '', weight: prev ? prev.weight : '', target: prev ? prev.target || '' : '', done: false });
  } else if (act === 'del-exo') {
    if (!confirm(`Retirer « ${t.ex.name || 'cet exercice'} » de la séance ?`)) return;
    t.block.exercises.splice(t.ei, 1);
    if (!t.block.exercises.length) workout.blocks.splice(t.bi, 1);
  }
  renderWorkout();
  scheduleWorkoutSave();
  // Pas de repos après la toute dernière série
  if (restAfter && updateWorkoutProgress() > 0) startRest(restAfter.seconds, restAfter.label);
});

// --- MINUTEUR DE REPOS ---
let rest = null;      // { endAt, total, label, timer, finished }
let audioCtx = null;
let wakeLock = null;
const restEl = document.getElementById('restTimer');

// L'audio doit être activé pendant un geste de l'utilisateur (iOS)
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
function beep() {
  if (!audioCtx) return;
  [0, 0.22, 0.44].forEach((t, i) => {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = i === 2 ? 1320 : 880;
    osc.connect(gain); gain.connect(audioCtx.destination);
    const start = audioCtx.currentTime + t;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.start(start); osc.stop(start + 0.2);
  });
}
function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function startRest(seconds, label) {
  stopRest();
  rest = { endAt: Date.now() + seconds * 1000, total: seconds, label, finished: false };
  document.getElementById('rtLabel').textContent = 'Repos · ' + (label || 'exercice');
  restEl.classList.remove('finished');
  restEl.hidden = false;
  rest.timer = setInterval(tickRest, 250);
  tickRest();
}
// Calculé à partir de l'heure de fin : reste juste même si le téléphone met l'appli en pause
function tickRest() {
  if (!rest) return;
  const left = (rest.endAt - Date.now()) / 1000;
  document.getElementById('rtTime').textContent = fmtClock(left);
  document.getElementById('rtBar').style.width = Math.max(0, Math.min(100, left / rest.total * 100)) + '%';
  if (left <= 0 && !rest.finished) {
    rest.finished = true;
    restEl.classList.add('finished');
    document.getElementById('rtLabel').textContent = 'Repos terminé · c\'est reparti !';
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    const ended = rest;
    setTimeout(() => { if (rest === ended) stopRest(); }, 6000);
  }
}
function stopRest() {
  if (rest) clearInterval(rest.timer);
  rest = null;
  restEl.hidden = true;
}
function adjustRest(delta) {
  if (!rest) return;
  if (rest.finished) {
    if (delta > 0) startRest(delta, rest.label);
    return;
  }
  rest.endAt += delta * 1000;
  rest.total = Math.max(rest.total, (rest.endAt - Date.now()) / 1000);
  tickRest();
}
document.getElementById('rtMinus').onclick = () => adjustRest(-15);
document.getElementById('rtPlus').onclick = () => adjustRest(15);
document.getElementById('rtSkip').onclick = stopRest;

// Garde l'écran allumé pendant la séance (si le navigateur le permet)
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  if (wakeLock) wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
}
function releaseAwake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && workout) { keepAwake(); tickRest(); }
});

document.getElementById('wkAddExo').onclick = () => {
  workout.blocks.push({ type: 'single', exercises: [{ name: '', rest: 0, sets: [{ reps: '', weight: '', target: '', done: false }] }] });
  renderWorkout();
  scheduleWorkoutSave();
  const names = wkBody.querySelectorAll('.wk-exo-name');
  const input = names[names.length - 1];
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input.focus();
};

document.getElementById('wkBack').onclick = async () => {
  if (wkSaveTimer) {
    try { await saveWorkout(); }
    catch (e) { if (!confirm('Les dernières modifications n\'ont pas pu être enregistrées. Quitter quand même ?')) return; }
  }
  hideWorkout();
};

document.getElementById('wkFinish').onclick = async () => {
  const remaining = updateWorkoutProgress();
  if (!workout.completed && remaining > 0 &&
      !confirm(`${remaining} série${remaining > 1 ? 's' : ''} non validée${remaining > 1 ? 's' : ''}. Terminer quand même ?`)) return;
  const wasCompleted = workout.completed;
  workout.blocks.forEach(b => { b.exercises = (b.exercises||[]).filter(ex => ex.name.trim()); });
  workout.blocks = workout.blocks.filter(b => b.exercises.length);
  workout.completed = true;
  await saveWorkout();
  hideWorkout();
  toast(wasCompleted ? 'Séance enregistrée' : 'Séance terminée 💪');
  loadSessions().catch(() => {});
};

// ===========================================
// TEMPLATES
// ===========================================
async function loadTemplates() {
  const data = await api('/api/templates');
  templates = Array.isArray(data) ? data : [];
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
    <input type="text" class="tpl-exo-name" placeholder="Exercice" value="${ex?escapeHtml(ex.name):''}" maxlength="200">
    <label class="unit-input" title="Séries"><input type="number" class="tpl-exo-sets" inputmode="numeric" placeholder="4" value="${ex?escapeHtml(ex.setsCount):4}" min="1" max="20"><span>séries</span></label>
    <label class="unit-input" title="Reps visées (ex : 8 ou 8-10)"><span>×</span><input type="text" class="tpl-exo-reps" inputmode="numeric" placeholder="8" value="${ex&&ex.reps?escapeHtml(ex.reps):''}" maxlength="10"><span>reps</span></label>
    <label class="unit-input" title="Repos">${icon('timer')}<input type="number" class="tpl-exo-rest" inputmode="numeric" placeholder="–" value="${ex&&ex.rest?escapeHtml(ex.rest):''}" min="0" max="3600"><span>s</span></label>
    <button class="icon-btn danger" aria-label="Supprimer l'exercice">${icon('x','ic-sm')}</button>
  `;
  div.querySelector('button').onclick = () => removeExoFrom(div, container);
  container.appendChild(div);
}

document.getElementById('saveTplBtn').onclick = async () => {
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
  if (editingTplId) {
    await api('/api/templates/'+editingTplId,{method:'PUT',body:body});
  } else {
    await api('/api/templates',{method:'POST',body:body});
  }
  closeModal('tplModal');
  toast('Template enregistré');
  await loadTemplates();
};

document.getElementById('deleteTplBtn').onclick = async () => {
  if (!editingTplId||!confirm('Supprimer ce template ?')) return;
  await api('/api/templates/'+editingTplId,{method:'DELETE'});
  closeModal('tplModal');
  toast('Template supprimé');
  await loadTemplates();
};

// --- APPLY TEMPLATE ---
document.getElementById('applyTplBtn').onclick = async () => {
  await loadTemplates();
  const list = document.getElementById('applyTplList');
  const empty = document.getElementById('applyTplEmpty');
  document.getElementById('applyTplWeek').textContent = 'Semaine du ' + frDateRange(currentWeekStart);
  list.innerHTML = '';
  empty.style.display = templates.length===0?'block':'none';
  templates.forEach(tpl => {
    const btn = document.createElement('div');
    btn.className = 'tpl-card card';
    btn.style.background = 'var(--surface-2)';
    btn.innerHTML = templateCardHTML(tpl);
    btn.onclick = async () => {
      if (!confirm(`Appliquer "${tpl.name}" à la semaine du ${frDateRange(currentWeekStart)} ?`)) return;
      await api('/api/templates/'+tpl.id+'/apply',{method:'POST',body:{weekStart:formatDate(currentWeekStart)}});
      closeModal('applyTplModal');
      toast(`"${tpl.name}" appliqué`);
      await loadSessions();
    };
    list.appendChild(btn);
  });
  openModal('applyTplModal');
};
document.getElementById('closeApplyTplBtn').onclick = () => closeModal('applyTplModal');

// --- TOP PERF ---
async function loadPerfs() {
  const data = await api('/api/top-perfs');
  perfs = Array.isArray(data) ? data : [];
  renderPerfs();
}

function renderPerfs() {
  const q = document.getElementById('perfSearch').value.trim().toLowerCase();
  const filtered = perfs.filter(p => p.exercise.toLowerCase().includes(q));
  const list = document.getElementById('perfList');
  const empty = document.getElementById('perfEmpty');
  list.innerHTML = '';
  empty.style.display = perfs.length===0?'block':'none';
  filtered.forEach(p => {
    const w = num(p.weight), r = num(p.reps);
    // Epley estimate of the one-rep max
    const oneRm = r > 1 && w > 0 ? Math.round(w * (1 + r/30)) : null;
    const div = document.createElement('div');
    div.className = 'perf-card card';
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
  const s = await api('/api/sessions/'+id);
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

// --- LOAD ---
async function loadSessions() {
  const data = await api('/api/sessions');
  sessions = Array.isArray(data) ? data : [];
  renderWeek();
}

renderWeek();
if (getToken()) startApp(); else showLogin();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
