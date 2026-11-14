const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { loadServer } = require('../test-support/fake-mongo');

const PASSWORD = 'mot-de-passe-test';

// --- Faux Strava : jetons, activités et retrait d'accès ---
const strava = {
  activities: [],
  tokenCalls: [],
  activityAuth: [],
  deauthorized: [],
  refreshStatus: 200,
  expiresIn: 6 * 3600
};
const stravaServer = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const url = new URL(req.url, 'http://strava.test');
  const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    const params = Object.fromEntries(new URLSearchParams(raw));
    strava.tokenCalls.push(params);
    if (params.client_secret !== 'secret-test') return send(401, { message: 'Bad Request' });
    if (params.grant_type === 'refresh_token' && strava.refreshStatus !== 200) return send(strava.refreshStatus, { message: 'invalid' });
    const n = strava.tokenCalls.length;
    return send(200, {
      access_token: `acces-${n}`,
      refresh_token: `renouvellement-${n}`,
      expires_at: Math.floor(Date.now() / 1000) + strava.expiresIn,
      ...(params.grant_type === 'authorization_code' ? { athlete: { id: 42, firstname: 'Helias', lastname: 'E.' } } : {})
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/v3/athlete/activities') {
    strava.activityAuth.push(req.headers.authorization);
    const after = Number(url.searchParams.get('after'));
    const page = Number(url.searchParams.get('page'));
    const list = page === 1 ? strava.activities.filter(a => new Date(a.start_date).getTime() / 1000 > after) : [];
    return send(200, list);
  }
  if (req.method === 'POST' && url.pathname === '/oauth/deauthorize') {
    strava.deauthorized.push(Object.fromEntries(new URLSearchParams(raw)));
    return send(200, {});
  }
  send(404, { message: 'Not Found' });
});

let base, server, collections;

test.before(async () => {
  await new Promise(r => stravaServer.listen(0, r));
  const loaded = loadServer(path.join(__dirname, '..', 'server.js'), {
    env: {
      APP_PASSWORD: PASSWORD,
      LOGIN_DELAY_MS: '1',
      PUBLIC_URL: 'https://exemple.test',
      STRAVA_CLIENT_ID: '12345',
      STRAVA_CLIENT_SECRET: ' STRAVA_CLIENT_SECRET="secret-test"\n',
      STRAVA_URL: `http://127.0.0.1:${stravaServer.address().port}`
    }
  });
  ({ collections } = loaded);
  await new Promise(r => { server = loaded.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); stravaServer.close(); server.closeAllConnections(); });

function call(method, url, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
}
async function login() {
  const res = await call('POST', '/api/login', { body: { password: PASSWORD } });
  assert.strictEqual(res.status, 200);
  return (await res.json()).token;
}
const isoDay = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
function activity(id, daysAgo, extra = {}) {
  const start = new Date(Date.now() - daysAgo * 86400000);
  return {
    id, name: `Course ${id}`, sport_type: 'Run', type: 'Run',
    start_date: start.toISOString(), start_date_local: start.toISOString().replace(/\.\d+Z$/, 'Z'),
    distance: 8234.5, moving_time: 2580, elapsed_time: 2700, total_elevation_gain: 64.3,
    average_heartrate: 151.6, max_heartrate: 178, workout_type: 0, ...extra
  };
}
async function connectStrava(token, scope = 'read,activity:read_all') {
  const { url } = await (await call('GET', '/api/strava/connect-url', { token })).json();
  const state = new URL(url).searchParams.get('state');
  return call('GET', `/api/strava/callback?state=${encodeURIComponent(state)}&code=code-test&scope=${scope}`);
}

test('une course est nettoyée : type connu, nombres bornés, virgule acceptée', async () => {
  const token = await login();
  const res = await call('POST', '/api/sessions', { token, body: {
    date: '2026-11-10', name: 'Footing', kind: 'run',
    run: { type: 'inconnu', distanceKm: '8,456', durationSec: 2700.4, elevation: -5, avgHr: 'abc', feeling: 9, stravaId: '12ab',
      target: { distanceKm: 8, durationSec: 2700, details: 'Allure facile' } }
  } });
  assert.strictEqual(res.status, 201);
  const session = await res.json();
  assert.strictEqual(session.kind, 'run');
  assert.deepStrictEqual(session.run, {
    type: 'footing', target: { distanceKm: 8, durationSec: 2700, details: 'Allure facile' },
    distanceKm: 8.46, durationSec: 2700, elevation: 0, avgHr: 0, maxHr: 0, feeling: 5, notes: ''
  });
  // Modifiée hors connexion puis renvoyée : reste une course
  const put = await call('PUT', `/api/sessions/${session.id}`, { token, body: { run: { ...session.run, distanceKm: 9 }, completed: true } });
  const updated = await put.json();
  assert.strictEqual(updated.kind, 'run');
  assert.strictEqual(updated.run.distanceKm, 9);
  assert.strictEqual(updated.completed, true);
});

test('une semaine type peut contenir des courses, appliquées avec leur objectif', async () => {
  const token = await login();
  const res = await call('POST', '/api/templates', { token, body: {
    name: 'Semaine hybride', weekType: 'Endurance',
    sessions: [
      { name: 'Push', dayOfWeek: 1, blocks: [{ type: 'single', exercises: [{ name: 'Bench', setsCount: 3, reps: '8' }] }] },
      { name: 'Fractionné', dayOfWeek: 3, kind: 'run', run: { type: 'fractionne', target: { distanceKm: 6, details: '6×400 m' } }, blocks: [{ type: 'single', exercises: [{ name: 'ignoré' }] }] }
    ]
  } });
  const tpl = await res.json();
  assert.deepStrictEqual(tpl.sessions[1].run, { type: 'fractionne', target: { distanceKm: 6, durationSec: 0, details: '6×400 m' } });
  assert.strictEqual(tpl.sessions[0].kind, 'gym');

  const applied = await (await call('POST', `/api/templates/${tpl.id}/apply`, { token, body: { weekStart: '2026-11-09' } })).json();
  const run = applied.sessions.find(s => s.kind === 'run');
  assert.strictEqual(run.date, '2026-11-11');
  assert.deepStrictEqual(run.blocks, []);
  assert.strictEqual(run.run.type, 'fractionne');
  assert.strictEqual(run.run.target.details, '6×400 m');
  assert.strictEqual(run.run.distanceKm, 0);
  assert.strictEqual(applied.sessions.find(s => s.name === 'Push').kind, undefined);
});

test('Strava : connexion refusée sans « state » valide ou sans accès aux activités', async () => {
  const token = await login();
  const status = await (await call('GET', '/api/strava', { token })).json();
  assert.deepStrictEqual(status, { configured: true, connected: false, athleteName: '', lastSyncAt: null });

  assert.strictEqual((await call('GET', '/api/strava/connect-url')).status, 401);
  const { url } = await (await call('GET', '/api/strava/connect-url', { token })).json();
  const link = new URL(url);
  assert.strictEqual(link.pathname, '/oauth/authorize');
  assert.strictEqual(link.searchParams.get('client_id'), '12345');
  assert.strictEqual(link.searchParams.get('redirect_uri'), 'https://exemple.test/api/strava/callback');
  assert.strictEqual(link.searchParams.get('scope'), 'read,activity:read_all');

  const forged = await call('GET', '/api/strava/callback?state=9999999999999.faux&code=x&scope=activity:read_all');
  assert.strictEqual(forged.status, 400);
  assert.match(await forged.text(), /Lien expiré/);
  assert.strictEqual((await connectStrava(token, 'read')).status, 400);
  assert.strictEqual(collections.integrations?.docs.length || 0, 0);
});

test('Strava : connexion, import des courses et complétion d\'une course prévue', async () => {
  const token = await login();
  const connected = await connectStrava(token);
  assert.strictEqual(connected.status, 200);
  assert.match(await connected.text(), /Strava connecté/);
  const exchange = strava.tokenCalls.at(-1);
  assert.strictEqual(exchange.grant_type, 'authorization_code');
  assert.strictEqual(exchange.client_secret, 'secret-test'); // valeur collée nettoyée
  const status = await (await call('GET', '/api/strava', { token })).json();
  assert.strictEqual(status.connected, true);
  assert.strictEqual(status.athleteName, 'Helias E.');
  assert.ok(!('accessToken' in status)); // les jetons ne quittent jamais le serveur

  // Une course prévue avec ressenti et objectif, puis faite le même jour
  const plannedDay = isoDay(-1);
  const planned = await (await call('POST', '/api/sessions', { token, body: {
    date: plannedDay, name: 'Sortie longue', kind: 'run', run: { type: 'longue', feeling: 4, target: { distanceKm: 12 } }
  } })).json();
  strava.activities = [
    activity(1001, 1, { workout_type: 0 }),
    activity(1002, 5, { name: 'Fractionné du mardi', workout_type: 3 }),
    activity(1003, 6, { sport_type: 'Ride', type: 'Ride' }),
    activity(1004, 90) // plus vieille que la première synchronisation (60 jours)
  ];
  strava.activities[0].start_date_local = `${plannedDay}T07:30:00Z`;

  const sync = await (await call('POST', '/api/strava/sync', { token, body: {} })).json();
  assert.deepStrictEqual(sync, { connected: true, created: 1, completed: 1 });
  assert.strictEqual(strava.activityAuth.at(-1), 'Bearer acces-' + strava.tokenCalls.length);

  const sessions = await (await call('GET', '/api/sessions', { token })).json();
  const done = sessions.find(s => s.id === planned.id);
  assert.strictEqual(done.completed, true);
  assert.strictEqual(done.name, 'Sortie longue');
  assert.deepStrictEqual(done.run, {
    type: 'longue', target: { distanceKm: 12, durationSec: 0, details: '' },
    distanceKm: 8.23, durationSec: 2580, elevation: 64, avgHr: 152, maxHr: 178, feeling: 4, notes: '', stravaId: '1001'
  });
  const created = sessions.find(s => s.run && s.run.stravaId === '1002');
  assert.strictEqual(created.name, 'Fractionné du mardi');
  assert.strictEqual(created.run.type, 'fractionne');
  assert.strictEqual(created.completed, true);
  assert.ok(!sessions.some(s => s.run && ['1003', '1004'].includes(s.run.stravaId)));

  // Juste après : pas de nouvel appel ; forcée : aucun doublon
  const again = await (await call('POST', '/api/strava/sync', { token, body: {} })).json();
  assert.strictEqual(again.skipped, true);
  const forced = await (await call('POST', '/api/strava/sync', { token, body: { force: true } })).json();
  assert.deepStrictEqual(forced, { connected: true, created: 0, completed: 0 });
  const after = await (await call('GET', '/api/sessions', { token })).json();
  assert.strictEqual(after.filter(s => s.run && s.run.stravaId).length, 2);

  // Export CSV : la course apparaît avec son résumé
  const csv = await (await call('GET', '/api/export?format=csv', { token })).text();
  assert.match(csv, /Fractionné du mardi;oui;course;fractionne;/);
  assert.match(csv, /8\.23 km · 43 min · D\+ 64 m · FC moy 152 · FC max 178/);
});

test('Strava : jeton expiré renouvelé, accès retiré = déconnexion propre', async () => {
  const token = await login();
  const link = collections.integrations.docs.find(d => d.id === 'strava');
  link.expiresAt = Math.floor(Date.now() / 1000) - 10;
  const calls = strava.tokenCalls.length;
  await call('POST', '/api/strava/sync', { token, body: { force: true } });
  assert.strictEqual(strava.tokenCalls.length, calls + 1);
  assert.strictEqual(strava.tokenCalls.at(-1).grant_type, 'refresh_token');
  assert.ok(collections.integrations.docs.find(d => d.id === 'strava').expiresAt > Date.now() / 1000);

  collections.integrations.docs.find(d => d.id === 'strava').expiresAt = 0;
  strava.refreshStatus = 401;
  const sync = await (await call('POST', '/api/strava/sync', { token, body: { force: true } })).json();
  assert.strictEqual(sync.connected, false);
  assert.strictEqual((await (await call('GET', '/api/strava', { token })).json()).connected, false);
  strava.refreshStatus = 200;
});

test('Strava : se déconnecter retire l\'accès et garde les courses importées', async () => {
  const token = await login();
  await connectStrava(token);
  const res = await call('DELETE', '/api/strava', { token });
  assert.strictEqual(res.status, 200);
  assert.ok(strava.deauthorized.at(-1).access_token.startsWith('acces-'));
  assert.strictEqual((await (await call('GET', '/api/strava', { token })).json()).connected, false);
  const sessions = await (await call('GET', '/api/sessions', { token })).json();
  assert.ok(sessions.some(s => s.run && s.run.stravaId === '1002'));
  const sync = await (await call('POST', '/api/strava/sync', { token, body: {} })).json();
  assert.deepStrictEqual(sync, { connected: false, configured: true });
});
