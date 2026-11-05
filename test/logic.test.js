const test = require('node:test');
const assert = require('node:assert');
const logic = require('../public/js/logic.js');

test('le poids accepte la virgule et garde toujours un point', () => {
  assert.strictEqual(logic.cleanWeightTyping('82,5'), '82.5');
  assert.strictEqual(logic.cleanWeightTyping('8a0.5,5'), '80.55');
  assert.strictEqual(logic.cleanWeightTyping('12'), '12');
  assert.strictEqual(logic.normalizeWeight(' 82,5 '), '82.5');
  assert.strictEqual(logic.normalizeWeight('82.'), '82');
});

test('+2.5 / -2.5 partent du champ, sinon de la dernière charge', () => {
  assert.strictEqual(logic.stepWeight('80', '', 2.5), '82.5');
  assert.strictEqual(logic.stepWeight('', '100', 2.5), '102.5');
  assert.strictEqual(logic.stepWeight('', '', 2.5), '2.5');
  assert.strictEqual(logic.stepWeight('82.5', '', -2.5), '80');
  assert.strictEqual(logic.stepWeight('2.5', '', -2.5), '');
  assert.strictEqual(logic.stepWeight('1', '', -2.5), '');
});

test('statut d\'une séance : prévue, terminée, manquée', () => {
  assert.strictEqual(logic.sessionStatus({ date: '2026-01-10', completed: true }, '2026-01-15'), 'done');
  assert.strictEqual(logic.sessionStatus({ date: '2026-01-10' }, '2026-01-15'), 'missed');
  assert.strictEqual(logic.sessionStatus({ date: '2026-01-15' }, '2026-01-15'), 'planned');
  assert.strictEqual(logic.sessionStatus({ date: '2026-01-20' }, '2026-01-15'), 'planned');
});

test('un même exercice est reconnu malgré casse, accents et espaces', () => {
  assert.strictEqual(logic.exerciseKey('  Développé   Couché '), 'developpe couche');
  assert.strictEqual(logic.exerciseKey('developpe couche'), 'developpe couche');
  assert.strictEqual(logic.exerciseKey(null), '');
});

test('les suggestions gardent les noms fréquents et leur orthographe courante', () => {
  const session = names => ({ blocks: [{ exercises: names.map(name => ({ name })) }] });
  const names = logic.buildExerciseNames(
    [session(['Squat', 'squat', 'Squat', 'Dips', '']), session(['Tirage'])],
    [{ sessions: [{ blocks: [{ exercises: [{ name: 'Dips' }] }] }] }]
  );
  assert.deepStrictEqual(names.slice(0, 2), ['Squat', 'Dips']);
  assert.ok(names.includes('Tirage'));
  assert.strictEqual(names.length, 3);
  assert.strictEqual(logic.canonicalExerciseName('  SQUAT ', names), 'Squat');
  assert.strictEqual(logic.canonicalExerciseName('Fentes', names), 'Fentes');
});

test('déplacer un exercice : dans le superset, sinon avec le bloc voisin', () => {
  const blocks = () => [
    { type: 'single', exercises: [{ name: 'A' }] },
    { type: 'superset', exercises: [{ name: 'B' }, { name: 'C' }] },
    { type: 'single', exercises: [{ name: 'D' }] }
  ];
  const names = b => b.map(x => x.exercises.map(e => e.name).join('+')).join(',');

  let b = blocks();
  assert.deepStrictEqual(logic.moveExercise(b, 1, 0, 1), { bi: 1, ei: 1 });
  assert.strictEqual(names(b), 'A,C+B,D');

  b = blocks();
  assert.deepStrictEqual(logic.moveExercise(b, 1, 0, -1), { bi: 0, ei: 0 });
  assert.strictEqual(names(b), 'B+C,A,D');

  b = blocks();
  assert.strictEqual(logic.moveExercise(b, 0, 0, -1), null);
  assert.strictEqual(logic.moveExercise(b, 2, 0, 1), null);
  assert.strictEqual(names(b), 'A,B+C,D');
});

test('la file d\'attente ne garde que la dernière version d\'une fiche', () => {
  let items = logic.upsertOutboxItem([], { kind: 'sessions', id: 'a', op: 'save', rev: 1 });
  items = logic.upsertOutboxItem(items, { kind: 'sessions', id: 'b', op: 'save', rev: 2 });
  items = logic.upsertOutboxItem(items, { kind: 'sessions', id: 'a', op: 'save', rev: 3 });
  items = logic.upsertOutboxItem(items, { kind: 'templates', id: 'a', op: 'save', rev: 4 });
  assert.strictEqual(items.length, 3);
  assert.strictEqual(items.find(i => i.kind === 'sessions' && i.id === 'a').rev, 3);
});

test('une version modifiée pendant l\'envoi n\'est pas perdue', () => {
  const sent = { kind: 'sessions', id: 'a', rev: 1 };
  const newer = [{ kind: 'sessions', id: 'a', rev: 2 }];
  assert.strictEqual(logic.removeOutboxItem(newer, sent).length, 1);
  assert.strictEqual(logic.removeOutboxItem([sent], sent).length, 0);
});

test('une suppression en attente d\'annulation n\'est pas encore envoyée', () => {
  const items = [
    { kind: 'sessions', id: 'a', op: 'delete', notBefore: 2000 },
    { kind: 'sessions', id: 'b', op: 'save', notBefore: 0 }
  ];
  assert.deepStrictEqual(logic.dueOutboxItems(items, 1000).map(i => i.id), ['b']);
  assert.strictEqual(logic.dueOutboxItems(items, 3000).length, 2);
});

test('les modifications en attente s\'appliquent sur les données du serveur', () => {
  const server = [{ id: 'a', name: 'Ancien', templateName: 'Force' }, { id: 'b', name: 'B' }];
  const result = logic.applyOutbox(server, [
    { kind: 'sessions', id: 'a', op: 'save', data: { name: 'Nouveau' } },
    { kind: 'sessions', id: 'b', op: 'delete' },
    { kind: 'sessions', id: 'c', op: 'save', data: { name: 'Hors ligne' } },
    { kind: 'templates', id: 'a', op: 'delete' }
  ], 'sessions');
  assert.deepStrictEqual(result, [
    { id: 'a', name: 'Nouveau', templateName: 'Force' },
    { id: 'c', name: 'Hors ligne' }
  ]);
  assert.strictEqual(server.length, 2);
});
