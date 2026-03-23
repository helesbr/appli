const readline = require('readline');

const tasks = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function showMenu() {
  console.log('\n===== MA TO-DO LIST =====');
  console.log('1. Voir les tâches');
  console.log('2. Ajouter une tâche');
  console.log('3. Supprimer une tâche');
  console.log('4. Quitter');
  rl.question('\nTon choix : ', handleChoice);
}

function handleChoice(choice) {
  if (choice === '1') {
    if (tasks.length === 0) {
      console.log('Aucune tâche pour le moment !');
    } else {
      console.log('\nTes tâches :');
      tasks.forEach((task, index) => {
        console.log(`  ${index + 1}. ${task}`);
      });
    }
    showMenu();

  } else if (choice === '2') {
    rl.question('Nouvelle tâche : ', (task) => {
      tasks.push(task);
      console.log(`✅ "${task}" ajoutée !`);
      showMenu();
    });

  } else if (choice === '3') {
    if (tasks.length === 0) {
      console.log('Aucune tâche à supprimer !');
      showMenu();
    } else {
      tasks.forEach((task, index) => {
        console.log(`  ${index + 1}. ${task}`);
      });
      rl.question('Numéro à supprimer : ', (num) => {
        const index = parseInt(num) - 1;
        if (index >= 0 && index < tasks.length) {
          const removed = tasks.splice(index, 1);
          console.log(`🗑️ "${removed}" supprimée !`);
        } else {
          console.log('Numéro invalide.');
        }
        showMenu();
      });
    }

  } else if (choice === '4') {
    console.log('À bientôt ! 👋');
    rl.close();

  } else {
    console.log('Choix invalide, réessaie.');
    showMenu();
  }
}

showMenu();