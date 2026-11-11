// Un jeton QStash d'une autre région que QSTASH_URL : le serveur doit trouver la bonne région tout seul
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { loadServer } = require('../test-support/fake-mongo');

const TOKEN = Buffer.from(JSON.stringify({ UserID: 'u', Password: 'p' })).toString('base64');
const published = [];
// La « mauvaise » région refuse tout ; la « bonne » accepte ce jeton
const wrongRegion = http.createServer((req, res) => {
  res.statusCode = 401;
  res.end(JSON.stringify({ error: 'unable to authenticate: invalid token' }));
});
const rightRegion = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; return res.end('{}'); }
  if (req.method === 'POST') published.push(req.url);
  res.end(req.method === 'GET' ? '[]' : '{}');
});

let base, server;
const listen = s => new Promise(r => s.listen(0, r));
const url = s => `http://127.0.0.1:${s.address().port}`;

test.before(async () => {
  await listen(wrongRegion);
  await listen(rightRegion);
  const { generateVAPIDKeys } = require('web-push');
  const vapid = generateVAPIDKeys();
  const loaded = loadServer(path.join(__dirname, '..', 'server.js'), {
    webPush: { sendNotification: async () => {} },
    env: {
      APP_PASSWORD: 'mot-de-passe-region',
      LOGIN_DELAY_MS: '1',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      QSTASH_TOKEN: TOKEN,
      QSTASH_URL: url(wrongRegion),
      QSTASH_REGION_URLS: `${url(wrongRegion)},${url(rightRegion)}`,
      PUBLIC_URL: 'https://exemple.test'
    }
  });
  await new Promise(r => { server = loaded.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close(); wrongRegion.close(); rightRegion.close();
  server.closeAllConnections(); wrongRegion.closeAllConnections(); rightRegion.closeAllConnections();
});

test('le contrôle de santé trouve la région qui accepte le jeton', async () => {
  const body = await (await fetch(`${base}/api/health`)).json();
  assert.strictEqual(body.checks.qstash, true);
  assert.strictEqual(body.checks.qstashToken, 'valide');
  assert.strictEqual(body.checks.qstashRegion, new URL(url(rightRegion)).host);
});

test('les notifications sont programmées dans la bonne région', async () => {
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'mot-de-passe-region' })
  });
  const { token } = await login.json();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const res = await fetch(`${base}/api/rest-timer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      seconds: 10,
      subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }
    })
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(published.length, 1);
});
