import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
// Dans le conteneur cloud, Chromium est préinstallé : on l'utilise si présent.
const localShell = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (require('fs').existsSync(localShell)) {
    Config.setBrowserExecutable(localShell);
  }
} catch {
  // ignore
}
