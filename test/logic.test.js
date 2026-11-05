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

test('la note rappelée est la plus récente, sans regarder cette séance ni le futur', () => {
  const session = (id, date, note, name = 'Développé couché') => ({ id, date, blocks: [{ exercises: [{ name, note }] }] });
  const sessions = [
    session('a', '2026-01-01', 'Ancienne'),
    session('b', '2026-01-08', 'Récente'),
    session('c', '2026-01-15', ''),
    session('d', '2026-01-20', 'Futur'),
    session('e', '2026-01-09', 'Autre exercice', 'Squat')
  ];
  assert.deepStrictEqual(logic.lastExerciseNote(sessions, 'developpe couche', '2026-01-15', 'c'), { date: '2026-01-08', note: 'Récente' });
  assert.strictEqual(logic.lastExerciseNote(sessions, 'Dips', '2026-01-15', 'c'), null);
  assert.strictEqual(logic.lastExerciseNote(sessions, '', '2026-01-15', 'c'), null);
});

test('addDaysIso passe les mois et les changements d\'heure', () => {
  assert.strictEqual(logic.addDaysIso('2026-01-28', 7), '2026-02-04');
  assert.strictEqual(logic.addDaysIso('2026-03-28', 7), '2026-04-04');
  assert.strictEqual(logic.addDaysIso('2026-03-02', -1), '2026-03-01');
});

test('dupliquer une séance garde le plan et les notes, et vide les résultats', () => {
  const source = {
    id: 'a', date: '2026-01-05', name: 'Push', completed: true, templateName: 'Force', weekType: 'Lourd',
    blocks: [{ type: 'superset', exercises: [{ name: 'Dips', rest: 60, note: 'Lesté', sets: [
      { reps: '10', weight: '20', target: '8', done: true },
      { reps: '12', weight: '20', target: '', done: true },
      { reps: '', weight: '', target: '', done: false }
    ] }] }]
  };
  const copy = logic.duplicateSession(source, '2026-01-12');
  assert.strictEqual(copy.id, undefined);
  assert.strictEqual(copy.date, '2026-01-12');
  assert.strictEqual(copy.completed, false);
  assert.strictEqual(copy.templateName, 'Force');
  assert.strictEqual(copy.blocks[0].type, 'superset');
  const ex = copy.blocks[0].exercises[0];
  assert.strictEqual(ex.note, 'Lesté');
  assert.strictEqual(ex.rest, 60);
  assert.deepStrictEqual(ex.sets, [
    { reps: '', weight: '', target: '8', done: false },
    { reps: '', weight: '', target: '12', done: false },
    { reps: '', weight: '', target: '', done: false }
  ]);
  assert.strictEqual(source.blocks[0].exercises[0].sets[0].weight, '20');
});

test('dupliquer une semaine type crée une copie indépendante', () => {
  const tpl = { id: 'a', name: 'Force', weekType: 'Lourd', sessions: [{ name: 'A', dayOfWeek: 1, blocks: [] }] };
  const copy = logic.duplicateTemplate(tpl);
  assert.strictEqual(copy.name, 'Force (copie)');
  assert.strictEqual(copy.id, undefined);
  copy.sessions[0].name = 'Modifiée';
  assert.strictEqual(tpl.sessions[0].name, 'A');
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
