const test = require('node:test');
const assert = require('node:assert');
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
    pushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  }
};

// --- Faux Strava : jetons, activités et retrait d'accès ---
const strava = {
  activities: [],
  tokenCalls: [],
  activityAuth: [],
  deauthorized: [],
  refreshStatus: 200,
  expiresIn: 6 * 3600,
  details: {},          // activités complètes par identifiant
  detailCalls: 0,
  subscriptions: [],    // abonnements aux alertes
  verification: null    // réponse de l'appli à la vérification de l'adresse
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
  const activityMatch = url.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
  if (req.method === 'GET' && activityMatch) {
    strava.detailCalls++;
    const full = strava.details[activityMatch[1]];
    return full ? send(200, full) : send(404, { message: 'Record Not Found' });
  }
  if (url.pathname.startsWith('/api/v3/push_subscriptions')) {
    if (url.searchParams.get('client_secret') !== 'secret-test' && !raw.includes('client_secret=secret-test')) return send(401, { message: 'Unauthorized' });
    if (req.method === 'GET') return send(200, strava.subscriptions);
    if (req.method === 'DELETE') {
      const id = Number(url.pathname.split('/').pop());
      strava.subscriptions = strava.subscriptions.filter(sub => sub.id !== id);
      res.statusCode = 204;
      return res.end();
    }
    // Création : comme Strava, on vérifie d'abord l'adresse de l'appli avec un « challenge »
    const params = Object.fromEntries(new URLSearchParams(raw));
    const check = new URL(params.callback_url.replace('https://exemple.test', base));
    check.searchParams.set('hub.mode', 'subscribe');
    check.searchParams.set('hub.challenge', 'defi-123');
    check.searchParams.set('hub.verify_token', params.verify_token);
    const answer = await fetch(check);
    strava.verification = { status: answer.status, body: await answer.json() };
    if (strava.verification.body['hub.challenge'] !== 'defi-123') return send(400, { message: 'callback url not verifiable' });
    const sub = { id: 100 + strava.subscriptions.length, callback_url: params.callback_url };
    strava.subscriptions.push(sub);
    return send(201, { id: sub.id });
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
    webPush: fakeWebPush,
    env: {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
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
// Version complète d'une activité, comme la renvoie GET /activities/{id}
function detailed(a, extra = {}) {
  return {
    ...a,
    athlete: { id: 42 },
    splits_metric: [
      { split: 1, distance: 1000.4, moving_time: 312, elapsed_time: 315, elevation_difference: 4.2, average_heartrate: 145.3 },
      { split: 2, distance: 1001, moving_time: 305, elapsed_time: 305, elevation_difference: -3.1, average_heartrate: 152.8 }
    ],
    best_efforts: [
      { name: '400m', elapsed_time: 98, pr_rank: 1 },
      { name: '1K', elapsed_time: 291, pr_rank: 1 },
      { name: '5K', elapsed_time: 1540, pr_rank: 2 }
    ],
    ...extra
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
  assert.deepStrictEqual(status, { configured: true, connected: false, athleteName: '', lastSyncAt: null, instant: false });

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
  // Import instantané : l'adresse a été vérifiée par Strava, puis l'abonnement créé
  assert.strictEqual(status.instant, true);
  assert.deepStrictEqual(strava.verification, { status: 200, body: { 'hub.challenge': 'defi-123' } });
  assert.deepStrictEqual(strava.subscriptions.map(sub => sub.callback_url), ['https://exemple.test/api/strava/webhook']);
  assert.strictEqual((await call('GET', '/api/strava/webhook?hub.mode=subscribe&hub.challenge=x&hub.verify_token=faux')).status, 403);

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
  // La 1001 a des détails (temps par km, records) ; la 1002 a été supprimée entre-temps (404)
  strava.details['1001'] = detailed(strava.activities[0]);

  const sync = await (await call('POST', '/api/strava/sync', { token, body: {} })).json();
  assert.deepStrictEqual(sync, { connected: true, created: 1, completed: 1, enriched: 0 });
  assert.strictEqual(strava.activityAuth.at(-1), 'Bearer acces-' + strava.tokenCalls.length);

  const sessions = await (await call('GET', '/api/sessions', { token })).json();
  const done = sessions.find(s => s.id === planned.id);
  assert.strictEqual(done.completed, true);
  assert.strictEqual(done.name, 'Sortie longue');
  assert.deepStrictEqual(done.run, {
    type: 'longue', target: { distanceKm: 12, durationSec: 0, details: '' },
    distanceKm: 8.23, durationSec: 2580, elevation: 64, avgHr: 152, maxHr: 178, feeling: 4, notes: '', stravaId: '1001',
    detailed: true,
    splits: [{ distance: 1000, sec: 312, elev: 4, hr: 145 }, { distance: 1001, sec: 305, elev: -3, hr: 153 }],
    // Le 400 m n'est pas gardé ; record perso = rang 1
    bestEfforts: [{ key: '1k', sec: 291, pr: true }, { key: '5k', sec: 1540, pr: false }]
  });
  const created = sessions.find(s => s.run && s.run.stravaId === '1002');
  assert.strictEqual(created.name, 'Fractionné du mardi');
  assert.strictEqual(created.run.type, 'fractionne');
  assert.strictEqual(created.completed, true);
  assert.ok(!sessions.some(s => s.run && ['1003', '1004'].includes(s.run.stravaId)));

  // Juste après : pas de nouvel appel ; forcée : aucun doublon
  const again = await (await call('POST', '/api/strava/sync', { token, body: {} })).json();
  assert.strictEqual(again.skipped, true);
  // Forcée : aucun doublon ; la 1002, importée sans détails, est complétée (ici : introuvable, marquée comme lue)
  const forced = await (await call('POST', '/api/strava/sync', { token, body: { force: true } })).json();
  assert.deepStrictEqual(forced, { connected: true, created: 0, completed: 0, enriched: 1 });
  const calls = strava.detailCalls;
  await call('POST', '/api/strava/sync', { token, body: { force: true } });
  assert.strictEqual(strava.detailCalls, calls); // plus rien à relire
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
  assert.deepStrictEqual(strava.subscriptions, []);
  assert.strictEqual((await (await call('GET', '/api/strava', { token })).json()).connected, false);
  const sessions = await (await call('GET', '/api/sessions', { token })).json();
  assert.ok(sessions.some(s => s.run && s.run.stravaId === '1002'));
  const sync = await (await call('POST', '/api/strava/sync', { token, body: {} })).json();
  assert.deepStrictEqual(sync, { connected: false, configured: true });
});

test('Strava : une alerte importe la course aussitôt et prévient les appareils abonnés', async () => {
  const token = await login();
  await connectStrava(token);
  const link = collections.integrations.docs.find(d => d.id === 'strava');
  // Ce téléphone s'abonne aux notifications
  const subscription = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'cle', auth: 'auth' } };
  assert.strictEqual((await call('PUT', '/api/devices/current/push', { token, body: { subscription: { endpoint: 'http://non-https' } } })).status, 400);
  assert.strictEqual((await call('PUT', '/api/devices/current/push', { token, body: { subscription } })).status, 200);

  const a = activity(2001, 0, { name: 'Footing du soir' });
  strava.details['2001'] = detailed(a);
  const event = { object_type: 'activity', object_id: 2001, aspect_type: 'create', owner_id: 42, subscription_id: link.webhookId, event_time: 1 };
  // Alerte d'un autre compte ou d'un autre abonnement : ignorée, sans appel à Strava
  const before = strava.detailCalls;
  for (const forged of [{ ...event, owner_id: 7 }, { ...event, subscription_id: 999 }]) {
    assert.strictEqual((await call('POST', '/api/strava/webhook', { body: forged })).status, 200);
  }
  assert.strictEqual(strava.detailCalls, before);

  pushes.length = 0;
  assert.strictEqual((await call('POST', '/api/strava/webhook', { body: event })).status, 200);
  let sessions = await (await call('GET', '/api/sessions', { token })).json();
  const imported = sessions.filter(s => s.run && s.run.stravaId === '2001');
  assert.strictEqual(imported.length, 1);
  assert.strictEqual(imported[0].run.splits.length, 2);
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].endpoint, subscription.endpoint);
  assert.deepStrictEqual(pushes[0].payload, {
    title: 'Course importée 🏃', tag: 'strava-run',
    body: 'Footing du soir : 8,23 km en 43:00 · 5:13 /km · 1 record perso 🏆'
  });

  // Strava renvoie l'alerte (ou une synchro passe en même temps) : ni doublon, ni seconde notification
  await call('POST', '/api/strava/webhook', { body: event });
  sessions = await (await call('GET', '/api/sessions', { token })).json();
  assert.strictEqual(sessions.filter(s => s.run && s.run.stravaId === '2001').length, 1);
  assert.strictEqual(pushes.length, 1);

  // Modification sur Strava (distance corrigée) : les chiffres suivent
  strava.details['2001'] = detailed({ ...a, distance: 8500 });
  await call('POST', '/api/strava/webhook', { body: { ...event, aspect_type: 'update' } });
  sessions = await (await call('GET', '/api/sessions', { token })).json();
  assert.strictEqual(sessions.find(s => s.run && s.run.stravaId === '2001').run.distanceKm, 8.5);

  // Une sortie vélo n'est pas importée
  strava.details['2002'] = detailed(activity(2002, 0, { sport_type: 'Ride', type: 'Ride' }));
  await call('POST', '/api/strava/webhook', { body: { ...event, object_id: 2002 } });
  sessions = await (await call('GET', '/api/sessions', { token })).json();
  assert.ok(!sessions.some(s => s.run && s.run.stravaId === '2002'));

  // Abonnement expiré : oublié, plus d'envoi
  pushError = Object.assign(new Error('Gone'), { statusCode: 410 });
  strava.details['2003'] = detailed(activity(2003, 0));
  await call('POST', '/api/strava/webhook', { body: { ...event, object_id: 2003 } });
  pushError = null;
  assert.ok(collections.devices.docs.every(d => !d.pushSubscription));
});

test('Strava : accès retiré depuis Strava = déconnexion', async () => {
  const token = await login();
  if (!collections.integrations.docs.some(d => d.id === 'strava')) await connectStrava(token);
  const link = collections.integrations.docs.find(d => d.id === 'strava');
  await call('POST', '/api/strava/webhook', { body: {
    object_type: 'athlete', object_id: 42, aspect_type: 'update', owner_id: 42, subscription_id: link.webhookId, updates: { authorized: 'false' }
  } });
  assert.strictEqual((await (await call('GET', '/api/strava', { token })).json()).connected, false);
});
