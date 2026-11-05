// Calendrier de la semaine et carte du jour
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
      const status = sessionStatus(s, today);
      totalSessions++;
      if (s.weekType || s.templateName) {
        const k = JSON.stringify([s.weekType || '', s.templateName || '']);
        weekTypes[k] = (weekTypes[k] || 0) + 1;
      }
      if (s.completed) doneSessions++;
      const statusLabel = { done: 'Terminée · ', missed: 'Manquée · ', planned: '' }[status];
      return `<div class="session-dot ${status}${s.completed?' completed':''}" data-id="${escapeHtml(s.id)}" role="button" tabindex="0" aria-label="Modifier ${escapeHtml(s.name)}">
        <div class="s-info">
          <span class="s-name">${escapeHtml(s.name)}</span>
          <span class="s-meta">${statusLabel}${st.exos} exo${st.exos>1?'s':''} · ${st.sets} séries</span>
        </div>
        ${s.completed
          ? `<span class="s-done" title="Séance terminée">${icon('check','ic-sm')}</span>`
          : `<button class="chip-play" data-play="${escapeHtml(s.id)}" aria-label="Lancer la séance">${icon('play','ic-sm')}</button>`}
      </div>`;
    }).join('');
    cell.innerHTML = `
      <div class="day-meta"><span class="day-name">${DAYS_SHORT[i]}</span><span class="day-num">${d.getDate()}</span></div>
      <div class="day-body">${chips || `<button class="day-empty">${icon('plus')}Repos · ajouter une séance</button>`}</div>`;
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
      <div class="hero-meta">${next ? `Prochaine séance : <b>${escapeHtml(next.name)}</b> · ${frDay(next.date)}` : 'Rien de prévu pour l\'instant. Prépare ta prochaine séance.'}</div>
      ${next ? '' : `<div class="hero-actions">
        <button class="btn btn-primary btn-sm" data-hero="new">${icon('plus','ic-sm')}Créer une séance</button>
        <button class="btn btn-secondary btn-sm" data-hero="apply">${icon('copy','ic-sm')}Appliquer une semaine type</button>
      </div>`}`;
  }
}
document.getElementById('heroCard').onclick = e => {
  const play = e.target.closest('[data-play]');
  if (play) return openWorkout(play.dataset.play);
  const action = e.target.closest('[data-hero]');
  if (!action) return;
  if (action.dataset.hero === 'new') openNewSession();
  else document.getElementById('applyTplBtn').click();
};

document.getElementById('prevWeek').onclick = () => { currentWeekStart.setDate(currentWeekStart.getDate()-7); renderWeek(); };
document.getElementById('nextWeek').onclick = () => { currentWeekStart.setDate(currentWeekStart.getDate()+7); renderWeek(); };
document.getElementById('todayBtn').onclick = () => { currentWeekStart = getMonday(new Date()); renderWeek(); };
