// Gestionnaire du son de fin de repos (soundManager)
// - iOS n'autorise un son automatique qu'après un geste : le contexte audio est débloqué dès le
//   premier toucher (tampon silencieux + resume), puis réutilisé à la fin du décompte.
// - Son joué : celui choisi dans les réglages, sinon public/sounds/notif.mp3 (ou .wav), sinon un bip.
// - Pas de navigator.mediaSession : le son ne prend pas la place de la musique sur l'écran verrouillé.
//   Pendant le son, la session audio passe en « transient » : iOS baisse la musique puis la remonte.
// Limite d'iOS : appli en arrière-plan ou écran verrouillé, la page est en pause et ne peut rien jouer ;
// c'est alors la notification de fin de repos qui prévient.
const SOUND_CACHE = 'moggtrack-sound';
const SOUND_KEY = '/__rest-sound';
const SOUND_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_SOUND_URLS = ['/sounds/notif.mp3', '/sounds/notif.wav'];
const SOUND_ENABLED_KEY = 'moggtrack-sound-enabled';

// Type de session audio (Safari 17+) ; ignoré par les navigateurs qui ne le gèrent pas
function setAudioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) {}
}

const soundManager = {
  ctx: null,
  playing: false,
  custom: { bytes: null, name: '', buffer: null },
  fallback: { buffer: null, url: '', tried: false },

  enabled() {
    try { return localStorage.getItem(SOUND_ENABLED_KEY) !== '0'; } catch (e) { return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(SOUND_ENABLED_KEY, on ? '1' : '0'); } catch (e) {}
    updateSoundUI();
  },

  // À appeler pendant un geste (toucher, clic) : sans geste, iOS refuse d'ouvrir le son
  unlock() {
    try {
      // « ambient » : se mélange à la musique sans l'interrompre (sauf pendant le son lui-même)
      if (!this.playing) setAudioSession('ambient');
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Un tampon silencieux joué pendant le geste marque le contexte comme autorisé
        const silent = this.ctx.createBufferSource();
        silent.buffer = this.ctx.createBuffer(1, 1, 22050);
        silent.connect(this.ctx.destination);
        silent.start(0);
      }
      // iOS remet le contexte en pause (« suspended » ou « interrupted ») quand l'appli passe en arrière-plan
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this.prepare();
    } catch (e) {}
  },

  // Décode les sons une seule fois ; le décodage demande le contexte audio
  async prepare() {
    if (!this.ctx) return;
    if (this.custom.bytes && !this.custom.buffer) {
      try { this.custom.buffer = await this.ctx.decodeAudioData(this.custom.bytes.slice(0)); } catch (e) { this.custom.buffer = null; }
    }
    if (!this.fallback.tried) {
      this.fallback.tried = true;
      for (const url of DEFAULT_SOUND_URLS) {
        try {
          const res = await fetch(url); // gardé hors connexion par le service worker
          if (!res.ok) continue;
          this.fallback.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.fallback.url = url;
          break;
        } catch (e) {}
      }
      updateSoundUI();
    }
  },

  // Joue le son de fin de repos ; force : même si le son est coupé (bouton « Écouter »)
  play(force) {
    if ((!this.enabled() && !force) || !this.ctx) return false;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    const buffer = this.custom.buffer || this.fallback.buffer;
    this.playing = true;
    setAudioSession('transient');
    const done = () => { this.playing = false; setAudioSession('ambient'); };
    if (buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.onended = done;
      source.start();
    } else {
      this.beep();
      setTimeout(done, 700);
    }
    return true;
  },

  // Bip synthétisé (Web Audio API), sans fichier
  beep() {
    [0, 0.22, 0.44].forEach((t, i) => {
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
      osc.frequency.value = i === 2 ? 1320 : 880;
      osc.connect(gain); gain.connect(this.ctx.destination);
      const start = this.ctx.currentTime + t;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.start(start); osc.stop(start + 0.2);
    });
  },

  // Son choisi dans les réglages : gardé sur le téléphone, jamais envoyé au serveur
  async loadCustom() {
    try {
      const res = await (await caches.open(SOUND_CACHE)).match(SOUND_KEY);
      this.custom.bytes = res ? await res.arrayBuffer() : null;
      this.custom.name = res ? decodeURIComponent(res.headers.get('X-Sound-Name') || 'son personnalisé') : '';
    } catch (e) {
      this.custom.bytes = null;
    }
    this.custom.buffer = null;
    updateSoundUI();
  }
};

// Appelées par le minuteur et le mode séance
function unlockAudio() { soundManager.unlock(); }
function playRestSound() { soundManager.play(); }

// Déblocage au premier toucher, puis à chaque toucher (contexte remis en pause par iOS en arrière-plan)
['pointerdown', 'touchend', 'keydown'].forEach(type => document.addEventListener(type, () => soundManager.unlock(), { capture: true, passive: true }));

function updateSoundUI() {
  const on = soundManager.enabled();
  const source = soundManager.custom.bytes ? soundManager.custom.name
    : soundManager.fallback.buffer ? 'son de l\'appli' : 'bip';
  document.getElementById('soundEnabled').checked = on;
  document.getElementById('soundStatus').textContent = on ? `Son : ${source}` : 'Son coupé';
  document.getElementById('soundRemoveBtn').hidden = !soundManager.custom.bytes;
}

document.getElementById('soundEnabled').addEventListener('change', async e => {
  soundManager.setEnabled(e.target.checked);
  // Activé : on l'entend tout de suite
  if (e.target.checked) {
    soundManager.unlock();
    await soundManager.prepare();
    soundManager.play();
  }
});

document.getElementById('soundFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > SOUND_MAX_BYTES) return toast('Fichier trop lourd : 3 Mo maximum (un son court suffit)', 'error');
  try {
    soundManager.unlock();
    const bytes = await file.arrayBuffer();
    // Vérifie que le téléphone sait le lire avant de le garder
    await soundManager.ctx.decodeAudioData(bytes.slice(0));
    const cache = await caches.open(SOUND_CACHE);
    await cache.put(SOUND_KEY, new Response(bytes, {
      headers: { 'Content-Type': file.type || 'audio/mpeg', 'X-Sound-Name': encodeURIComponent(file.name) }
    }));
    await soundManager.loadCustom();
    await soundManager.prepare();
    toast('Son de fin de repos enregistré');
  } catch (err) {
    toast('Ce fichier audio ne peut pas être lu : essaie un MP3 ou un M4A', 'error');
  }
});

document.getElementById('soundTestBtn').onclick = async () => {
  soundManager.unlock();
  await soundManager.prepare();
  soundManager.play(true);
};

document.getElementById('soundRemoveBtn').onclick = async () => {
  try { await (await caches.open(SOUND_CACHE)).delete(SOUND_KEY); } catch (e) {}
  await soundManager.loadCustom();
  toast('Son personnalisé retiré');
};

document.getElementById('notifTestBtn').onclick = e => testRestNotification(e.currentTarget);

if ('caches' in window) soundManager.loadCustom();
else updateSoundUI();
