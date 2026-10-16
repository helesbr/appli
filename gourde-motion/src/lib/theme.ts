import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

export const COLORS = {
	navy: '#0F2742',
	night: '#0B1B2E',
	cyan: '#0891B2',
	cyanBright: '#22D3EE',
	cyanIce: '#E0F2FE',
	orange: '#F97316',
	white: '#FFFFFF',
	mist: '#B9C7D8',
};

// Polices Google Fonts (licence OFL) embarquées dans public/fonts : le rendu ne
// dépend pas du réseau et reste identique d'une machine à l'autre.
const FONTS = [
	{family: 'Bebas Neue', file: 'BebasNeue-400.woff2', weight: '400'},
	...['300', '400', '700', '900'].map((weight) => ({family: 'Lato', file: `Lato-${weight}.woff2`, weight})),
];
for (const f of FONTS) {
	loadFont({family: f.family, url: staticFile(`fonts/${f.file}`), weight: f.weight, format: 'woff2'});
}

/** Police des titres (condensée, majuscules). */
export const TITLE = "'Bebas Neue', 'Oswald', sans-serif";
/** Police des textes courts. */
export const BODY = "'Lato', sans-serif";

/** Lueur cyan réutilisable (LED). */
export const glow = (strength = 1) =>
	`0 0 ${8 * strength}px ${COLORS.cyanBright}, 0 0 ${22 * strength}px ${COLORS.cyan}, 0 0 ${48 * strength}px rgba(8,145,178,0.6)`;
