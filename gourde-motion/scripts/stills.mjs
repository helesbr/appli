// Génère des images fixes de contrôle pour chaque scène, en 16:9 et 9:16.
// Usage : node scripts/stills.mjs [dossier_sortie] [image1,image2,...]
import path from 'node:path';
import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

const outDir = process.argv[2] ?? 'out/stills';
const frames = process.argv[3]
	? process.argv[3].split(',').map(Number)
	: [70, 115, 185, 250, 330, 420, 500, 590, 690, 760, 815, 885];
const shell = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browserExecutable = fs.existsSync(shell) ? shell : null;

fs.mkdirSync(outDir, {recursive: true});
const serveUrl = await bundle({entryPoint: path.resolve('src/index.ts')});
for (const id of ['GourdeConnectee', 'GourdeConnecteeVertical']) {
	const composition = await selectComposition({serveUrl, id, browserExecutable});
	for (const frame of frames) {
		const output = path.join(outDir, `${id === 'GourdeConnectee' ? '16x9' : '9x16'}-f${String(frame).padStart(3, '0')}.png`);
		await renderStill({serveUrl, composition, frame, output, browserExecutable, overwrite: true});
		console.log(output);
	}
}
