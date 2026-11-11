const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const source = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');

function loadWorker() {
  const listeners = {};
  const shown = [];
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'https://moggtrack.test' },
    clients: { matchAll: async () => [] },
    registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); } }
  };
  vm.runInNewContext(source, { self, URL, Promise, console, caches: { open: async () => ({ put() {}, match: async () => undefined }) }, Request: class {}, fetch: async () => ({ ok: true, clone() { return this; } }) });
  return { listeners, shown };
}
async function push(data) {
  const { listeners, shown } = loadWorker();
  let waited;
  listeners.push({ data, waitUntil: p => { waited = p; } });
  await waited;
  return shown;
}

test('un push affiche la notification de fin de repos', async () => {
  const shown = await push({ json: () => ({ title: 'Repos terminé', body: "Bench : c'est reparti !" }) });
  assert.strictEqual(shown.length, 1);
  assert.strictEqual(shown[0].title, 'Repos terminé');
  assert.strictEqual(shown[0].body, "Bench : c'est reparti !");
  assert.strictEqual(shown[0].tag, 'rest-timer');
});

test('un push vide ou illisible affiche quand même une notification (exigé par Safari)', async () => {
  assert.strictEqual((await push(null)).length, 1);
  assert.strictEqual((await push({ json: () => { throw new Error('illisible'); } })).length, 1);
});

test('une mise à jour de l\'appli garde le son choisi', async () => {
  const deleted = [];
  const listeners = {};
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    location: { origin: 'https://moggtrack.test' },
    clients: { claim: async () => {} },
    registration: {}
  };
  const caches = {
    keys: async () => ['moggtrack-shell-v1', 'moggtrack-sound', 'moggtrack-api'],
    delete: async key => { deleted.push(key); }
  };
  vm.runInNewContext(source, { self, URL, Promise, console, caches, Request: class {}, fetch: async () => ({}) });
  let waited;
  listeners.activate({ waitUntil: p => { waited = p; } });
  await waited;
  assert.deepStrictEqual(deleted, ['moggtrack-shell-v1']);
});

test('le fonctionnement hors connexion ne garde que les données utiles', () => {
  const { listeners } = loadWorker();
  const respondsTo = pathname => {
    let responded = false;
    listeners.fetch({
      request: { method: 'GET', url: 'https://moggtrack.test' + pathname, mode: 'cors' },
      respondWith: () => { responded = true; }
    });
    return responded;
  };
  assert.strictEqual(respondsTo('/api/sessions'), true);
  assert.strictEqual(respondsTo('/api/templates'), true);
  assert.strictEqual(respondsTo('/api/top-perfs'), true);
  assert.strictEqual(respondsTo('/api/export'), false);
  assert.strictEqual(respondsTo('/api/devices'), false);
  assert.strictEqual(respondsTo('/api/health'), false);
});

test('chaque script de la page est mis en cache pour le mode hors connexion', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length > 5);
  const shell = source.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  for (const script of scripts) {
    assert.ok(shell.includes(`'${script}'`), `${script} manque dans le cache`);
    assert.ok(fs.existsSync(path.join(publicDir, script)), `${script} n'existe pas`);
  }
});
