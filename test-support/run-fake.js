// Lance l'appli en local sans Atlas, pour l'essayer : node test-support/run-fake.js
// Mot de passe : test-local. Les données disparaissent à l'arrêt.
const path = require('path');
const { loadServer } = require('./fake-mongo');

const { app } = loadServer(path.join(__dirname, '..', 'server.js'), {
  env: { APP_PASSWORD: 'test-local', LOGIN_DELAY_MS: '1' }
});
const port = Number(process.env.PORT) || 3456;
app.listen(port, () => console.log(`Essai local sur http://localhost:${port} (mot de passe : test-local)`));
