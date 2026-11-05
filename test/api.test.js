const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { loadServer } = require('../test-support/fake-mongo');

const PASSWORD = 'mot-de-passe-test';
const realWebPush = require('web-push');
const vapid = realWebPush.generateVAPIDKeys();
const pushes = [];
let pushError = null;
const fakeWebPush = {
  sendNotification: async (subscription, payload) => {
    if (pushError) throw pushError;
    pushes.push({ subscription, payload: JSON.parse(payload) });
  }
};

const published = [];
let qstashStatus = 200;
const qstash = http.createServer((req, res) => {
  published.push({ url: req.url, auth: req.headers.authorization, delay: req.headers['upstash-delay'] });
  res.statusCode = qstashStatus;
  res.end('{}');
});

let base, server, collections, state;
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const subscription = {
  endpoint: 'https://web.push.apple.com/abc',
  keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
};

test.before(async () => {
  await new Promise(r => qstash.listen(0, r));
  const loaded = loadServer(path.join(__dirname, '..', 'server.js'), {
    webPush: fakeWebPush,
    env: {
      APP_PASSWORD: PASSWORD,
      LOGIN_DELAY_MS: '1',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      QSTASH_TOKEN: 'jeton-test',
      QSTASH_URL: `http://127.0.0.1:${qstash.address().port}`,
      PUBLIC_URL: 'https://exemple.test'
    }
  });
  ({ collections, state } = loaded);
  await new Promise(r => { server = loaded.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); qstash.close(); server.closeAllConnections(); });

function call(method, url, { token, body, ip } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  return fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
async function login(deviceName = 'iPhone (appli)', ip = '10.0.0.1') {
  const res = await call('POST', '/api/login', { body: { password: PASSWORD, deviceName }, ip });
  assert.strictEqual(res.status, 200);
  return (await res.json()).token;
}
function legacyToken() {
  const exp = String(Date.now() + 100000);
  const sig = crypto.createHmac('sha256', 'moggtrack:' + PASSWORD).update(exp).digest('base64url');
  return `${exp}.${sig}`;
}

test('sans connexion, les données sont refusées', async () => {
  for (const url of ['/api/sessions', '/api/templates', '/api/export', '/api/devices', '/api/top-perfs']) {
    assert.strictEqual((await call('GET', url)).status, 401, url);
  }
  assert.strictEqual((await call('GET', '/api/sessions', { token: 'd.faux.faux' })).status, 401);
});

test('le blocage après 5 mauvais mots de passe ne touche que cette adresse', async () => {
  const ip = '10.9.9.9';
  for (let i = 0; i < 5; i++) {
    const res = await call('POST', '/api/login', { body: { password: 'faux' }, ip });
    assert.strictEqual(res.status, 401);
  }
  const blocked = await call('POST', '/api/login', { body: { password: PASSWORD }, ip });
  assert.strictEqual(blocked.status, 429);
  assert.match((await blocked.json()).error, /réessaie dans \d+ min/);
  assert.strictEqual((await call('POST', '/api/login', { body: { password: PASSWORD }, ip: '10.9.9.8' })).status, 200);
});

test('une connexion réussie efface les échecs précédents', async () => {
  const ip = '10.8.8.8';
  for (let i = 0; i < 4; i++) await call('POST', '/api/login', { body: { password: 'faux' }, ip });
  assert.strictEqual((await call('POST', '/api/login', { body: { password: PASSWORD }, ip })).status, 200);
  assert.strictEqual((await call('POST', '/api/login', { body: { password: 'faux' }, ip })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { body: { password: PASSWORD }, ip })).status, 200);
});

test('un appareil peut être déconnecté sans toucher aux autres', async () => {
  const phone = await login('Téléphone');
  const laptop = await login('Ordinateur');
  const devices = await (await call('GET', '/api/devices', { token: phone })).json();
  const laptopDevice = devices.find(d => d.name === 'Ordinateur');
  assert.strictEqual(devices.find(d => d.name === 'Téléphone').current, true);
  assert.strictEqual(laptopDevice.current, false);

  assert.strictEqual((await call('DELETE', `/api/devices/${laptopDevice.id}`, { token: phone })).status, 200);
  assert.strictEqual((await call('GET', '/api/sessions', { token: laptop })).status, 401);
  assert.strictEqual((await call('GET', '/api/sessions', { token: phone })).status, 200);
});

test('une signature d\'appareil falsifiée est refusée', async () => {
  const token = await login();
  const [, id] = token.split('.');
  assert.strictEqual((await call('GET', '/api/sessions', { token: `d.${id}.fausse` })).status, 401);
});

test('un ancien jeton reste valable et passe au système par appareil sans mot de passe', async () => {
  const legacy = legacyToken();
  assert.strictEqual((await call('GET', '/api/sessions', { token: legacy })).status, 200);
  const res = await call('POST', '/api/token/upgrade', { token: legacy, body: { deviceName: 'iPhone migré' } });
  const { token } = await res.json();
  assert.match(token, /^d\./);
  assert.strictEqual((await call('GET', '/api/sessions', { token })).status, 200);
});

test('séance créée hors connexion : garde son identifiant, et un renvoi ne crée pas de doublon', async () => {
  const token = await login();
  const id = crypto.randomUUID();
  const body = { date: '2026-03-02', name: 'Push', blocks: [{ type: 'single', exercises: [{ name: 'Bench', rest: 90, sets: [{ reps: '8', weight: '82,5', target: '8', done: true }] }] }], completed: false };
  for (let i = 0; i < 2; i++) {
    const res = await call('PUT', `/api/sessions/${id}`, { token, body });
    assert.strictEqual(res.status, 200);
    const saved = await res.json();
    assert.strictEqual(saved.id, id);
    assert.strictEqual(saved._id, undefined);
    assert.strictEqual(saved.blocks[0].exercises[0].sets[0].weight, '82.5');
    assert.strictEqual(saved.blocks[0].exercises[0].sets[0].done, true);
  }
  const all = await (await call('GET', '/api/sessions', { token })).json();
  assert.strictEqual(all.filter(s => s.id === id).length, 1);
});

test('modifier une séance conserve la semaine type d\'origine', async () => {
  const token = await login();
  const tpl = await (await call('POST', '/api/templates', { token, body: { name: 'Force', weekType: 'Lourd', sessions: [{ name: 'Legs', dayOfWeek: 3, blocks: [{ type: 'single', exercises: [{ name: 'Squat', setsCount: 2, reps: '5', rest: 180 }] }] }] } })).json();
  const applied = await (await call('POST', `/api/templates/${tpl.id}/apply`, { token, body: { weekStart: '2026-03-02' } })).json();
  const session = applied.sessions[0];
  assert.strictEqual(session.date, '2026-03-04');
  assert.strictEqual(session.blocks[0].exercises[0].sets.length, 2);

  const updated = await (await call('PUT', `/api/sessions/${session.id}`, { token, body: { date: session.date, name: 'Legs lourd', blocks: session.blocks, completed: true } })).json();
  assert.strictEqual(updated.templateName, 'Force');
  assert.strictEqual(updated.weekType, 'Lourd');
  assert.strictEqual(updated.completed, true);
});

test('modification invalide : refusée sans créer de séance', async () => {
  const token = await login();
  const id = crypto.randomUUID();
  assert.strictEqual((await call('PUT', `/api/sessions/${id}`, { token, body: { date: 'hier', name: 'x' } })).status, 400);
  assert.strictEqual((await call('PUT', `/api/sessions/${id}`, { token, body: {} })).status, 400);
  assert.strictEqual((await call('PUT', `/api/sessions/${id}`, { token, body: { completed: true } })).status, 404);
  assert.strictEqual((await call('PUT', '/api/sessions/pas-un-uuid', { token, body: { date: '2026-01-01', name: 'x' } })).status, 404);
});

test('semaine type créée hors connexion : garde son identifiant', async () => {
  const token = await login();
  const id = crypto.randomUUID();
  const res = await call('PUT', `/api/templates/${id}`, { token, body: { name: 'Volume', weekType: '', sessions: [] } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).id, id);
  assert.strictEqual((await call('PUT', `/api/templates/${crypto.randomUUID()}`, { token, body: { weekType: 'x' } })).status, 404);
});

test('les records regroupent un exercice écrit de plusieurs façons', async () => {
  const token = await login();
  const make = (name, weight) => ({ date: '2026-04-01', name: 'S', blocks: [{ type: 'single', exercises: [{ name, sets: [{ reps: '5', weight }] }] }] });
  await call('PUT', `/api/sessions/${crypto.randomUUID()}`, { token, body: make('Développé incliné', '60') });
  await call('PUT', `/api/sessions/${crypto.randomUUID()}`, { token, body: make('developpe  INCLINE', '70') });
  const perfs = await (await call('GET', '/api/top-perfs', { token })).json();
  const found = perfs.filter(p => /incline|incliné/i.test(p.exercise));
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].weight, 70);
});

test('export JSON complet et CSV lisible, sans formule exécutable', async () => {
  const token = await login();
  await call('PUT', `/api/sessions/${crypto.randomUUID()}`, { token, body: { date: '2026-05-01', name: '=HACK()', blocks: [{ type: 'single', exercises: [{ name: 'Tirage; poulie', rest: 60, sets: [{ reps: '10', weight: '50.5', target: '10', done: true }] }] }] } });

  const json = await call('GET', '/api/export', { token });
  assert.match(json.headers.get('content-disposition'), /moggtrack-.*\.json/);
  const data = await json.json();
  assert.ok(data.sessions.length > 0);
  assert.ok(Array.isArray(data.templates));
  assert.strictEqual(data.sessions[0]._id, undefined);

  const csv = await call('GET', '/api/export?format=csv', { token });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const buffer = Buffer.from(await csv.arrayBuffer());
  assert.strictEqual(buffer.subarray(0, 3).toString('hex'), 'efbbbf');
  const text = buffer.toString('utf8');
  const line = text.split('\r\n').find(l => l.includes('poulie'));
  assert.strictEqual(line, `2026-05-01;'=HACK();non;simple;"Tirage; poulie";60;1;10;10;50.5;oui`);
});

test('notification : programmée via QStash, envoyée une fois, annulable et remplaçable', async () => {
  const token = await login();
  const create = async (extra = {}) => (await (await call('POST', '/api/rest-timer', { token, body: { seconds: 90, label: 'Bench', subscription, ...extra } })).json()).id;

  const id = await create();
  const last = published.at(-1);
  assert.strictEqual(last.url, `/v2/publish/https://exemple.test/api/rest-timer/${id}/fire`);
  assert.strictEqual(last.auth, 'Bearer jeton-test');
  assert.strictEqual(last.delay, '90s');

  const before = pushes.length;
  assert.strictEqual((await (await call('POST', `/api/rest-timer/${id}/fire`)).json()).sent, true);
  assert.strictEqual((await (await call('POST', `/api/rest-timer/${id}/fire`)).json()).sent, false);
  assert.strictEqual(pushes.length, before + 1);
  assert.strictEqual(pushes.at(-1).payload.body, "Bench : c'est reparti !");

  const skipped = await create();
  await call('DELETE', `/api/rest-timer/${skipped}`, { token });
  assert.strictEqual((await (await call('POST', `/api/rest-timer/${skipped}/fire`)).json()).sent, false);

  const first = await create();
  const second = await create({ replaces: first, seconds: 105 });
  assert.strictEqual(published.at(-1).delay, '105s');
  assert.strictEqual((await (await call('POST', `/api/rest-timer/${first}/fire`)).json()).sent, false);
  assert.strictEqual((await (await call('POST', `/api/rest-timer/${second}/fire`)).json()).sent, true);
});

test('notification : abonnement expiré sans relance, erreur temporaire relancée', async () => {
  const token = await login();
  const create = async () => (await (await call('POST', '/api/rest-timer', { token, body: { seconds: 60, subscription } })).json()).id;

  const expired = await create();
  pushError = Object.assign(new Error('gone'), { statusCode: 410 });
  assert.deepStrictEqual(await (await call('POST', `/api/rest-timer/${expired}/fire`)).json(), { sent: false, expired: true });

  const temporary = await create();
  pushError = Object.assign(new Error('boom'), { statusCode: 500 });
  assert.strictEqual((await call('POST', `/api/rest-timer/${temporary}/fire`)).status, 502);
  pushError = null;
  assert.strictEqual((await (await call('POST', `/api/rest-timer/${temporary}/fire`)).json()).sent, true);
});

test('notification : refus de QStash signalé à l\'appli', async () => {
  const token = await login();
  qstashStatus = 401;
  const res = await call('POST', '/api/rest-timer', { token, body: { seconds: 60, subscription } });
  qstashStatus = 200;
  assert.strictEqual(res.status, 502);
  assert.match((await res.json()).error, /QStash/);
  assert.strictEqual((await call('POST', '/api/rest-timer', { token, body: { seconds: 60, subscription: { endpoint: 'http://x' } } })).status, 400);
});

test('état du serveur : public, sans détail, et en échec si la base tombe', async () => {
  collections.appErrors.docs = [];
  const ok = await call('GET', '/api/health');
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await ok.json(), { ok: true, checks: { database: true, password: true, notifications: true, recentErrors: 0 } });

  state.down = true;
  const down = await call('GET', '/api/health');
  state.down = false;
  assert.strictEqual(down.status, 503);
  assert.strictEqual((await down.json()).checks.database, false);
});

test('état du serveur : en échec après plusieurs erreurs récentes', async () => {
  const now = new Date();
  collections.appErrors.docs = [1, 2, 3].map(i => ({ _id: i, source: 'push', message: 'x', at: now }));
  const res = await call('GET', '/api/health');
  collections.appErrors.docs = [];
  assert.strictEqual(res.status, 503);
  assert.strictEqual((await res.json()).checks.recentErrors, 3);
});

// Exécuté en dernier : déconnecte tout le monde
test('« Tout déconnecter » coupe aussi les anciens jetons', async () => {
  const token = await login();
  const legacy = legacyToken();
  assert.strictEqual((await call('GET', '/api/sessions', { token: legacy })).status, 200);
  assert.strictEqual((await call('POST', '/api/devices/logout-all', { token, body: {} })).status, 200);
  assert.strictEqual((await call('GET', '/api/sessions', { token })).status, 401);
  assert.strictEqual((await call('GET', '/api/sessions', { token: legacy })).status, 401);
  const fresh = await login();
  assert.strictEqual((await call('GET', '/api/sessions', { token: fresh })).status, 200);
});

test('le chiffrement réel des notifications et la signature VAPID fonctionnent', () => {
  const details = realWebPush.generateRequestDetails(subscription, JSON.stringify({ title: 'Repos terminé' }), {
    vapidDetails: { subject: 'https://moggtrack.vercel.app', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 120,
    urgency: 'high'
  });
  assert.strictEqual(details.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(details.headers.Authorization.startsWith('vapid t='));
});
