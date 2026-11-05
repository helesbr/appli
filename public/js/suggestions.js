// Suggestions de noms d'exercices : évite qu'un même exercice existe sous plusieurs noms,
// ce qui fausserait les records et l'historique.
let exerciseNames = [];

function refreshExerciseSuggestions() {
  exerciseNames = buildExerciseNames(sessions, templates);
  const list = document.getElementById('exoSuggestions');
  list.replaceChildren(...exerciseNames.map(name => {
    const option = document.createElement('option');
    option.value = name;
    return option;
  }));
}
// À la fin de la saisie, « bench  press » devient « Bench press » s'il existe déjà
document.addEventListener('change', e => {
  const el = e.target;
  if (!el.matches || !el.matches('.exo-name, .wk-exo-name, .tpl-exo-name')) return;
  const canonical = canonicalExerciseName(el.value, exerciseNames);
  if (canonical !== el.value) {
    el.value = canonical;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
