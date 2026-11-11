// Son de fin de repos choisi par l'utilisateur : un fichier audio gardé sur le téléphone
// (stockage du navigateur), jamais envoyé au serveur. Sans fichier, on garde le bip.
const SOUND_CACHE = 'moggtrack-sound';
const SOUND_KEY = '/__rest-sound';
const SOUND_MAX_BYTES = 3 * 1024 * 1024;
let customSoundBytes = null;
let customSoundBuffer = null;
let customSoundName = '';

function updateSoundUI() {
  document.getElementById('soundStatus').textContent = customSoundBytes
    ? `Son : ${customSoundName}`
    : 'Son : bip par défaut';
  document.getElementById('soundRemoveBtn').hidden = !customSoundBytes;
}

async function loadCustomSound() {
  try {
    const res = await (await caches.open(SOUND_CACHE)).match(SOUND_KEY);
    customSoundBytes = res ? await res.arrayBuffer() : null;
    customSoundName = res ? decodeURIComponent(res.headers.get('X-Sound-Name') || 'son personnalisé') : '';
  } catch (e) {
    customSoundBytes = null;
  }
  customSoundBuffer = null;
  updateSoundUI();
}

// Le décodage demande le contexte audio, ouvert pendant un geste (validation d'une série, Écouter…)
async function prepareCustomSound() {
  if (customSoundBuffer || !customSoundBytes || !audioCtx) return;
  try {
    customSoundBuffer = await audioCtx.decodeAudioData(customSoundBytes.slice(0));
  } catch (e) {
    customSoundBuffer = null;
  }
}

function playRestSound() {
  if (!audioCtx || !customSoundBuffer) return beep();
  // « transient » : la musique baisse le temps du son puis reprend (navigateurs qui le gèrent)
  if (navigator.audioSession) navigator.audioSession.type = 'transient';
  const source = audioCtx.createBufferSource();
  source.buffer = customSoundBuffer;
  source.connect(audioCtx.destination);
  source.onended = () => { if (navigator.audioSession) navigator.audioSession.type = 'auto'; };
  source.start();
}

document.getElementById('soundFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > SOUND_MAX_BYTES) return toast('Fichier trop lourd : 3 Mo maximum (un son court suffit)', 'error');
  try {
    unlockAudio();
    const bytes = await file.arrayBuffer();
    // Vérifie que le téléphone sait le lire avant de le garder
    await audioCtx.decodeAudioData(bytes.slice(0));
    const cache = await caches.open(SOUND_CACHE);
    await cache.put(SOUND_KEY, new Response(bytes, {
      headers: { 'Content-Type': file.type || 'audio/mpeg', 'X-Sound-Name': encodeURIComponent(file.name) }
    }));
    await loadCustomSound();
    await prepareCustomSound();
    toast('Son de fin de repos enregistré');
  } catch (err) {
    toast('Ce fichier audio ne peut pas être lu : essaie un MP3 ou un M4A', 'error');
  }
});

document.getElementById('soundTestBtn').onclick = async () => {
  unlockAudio();
  await prepareCustomSound();
  playRestSound();
};

document.getElementById('soundRemoveBtn').onclick = async () => {
  try { await (await caches.open(SOUND_CACHE)).delete(SOUND_KEY); } catch (e) {}
  await loadCustomSound();
  toast('Retour au bip');
};

document.getElementById('notifTestBtn').onclick = e => testRestNotification(e.currentTarget);

if ('caches' in window) loadCustomSound();
