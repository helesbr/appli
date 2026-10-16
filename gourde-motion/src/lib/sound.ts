import {random} from 'remotion';
import {SCENES} from './timing';

/**
 * Sound design : chaque repère joue un fichier de public/sfx/ à une image donnée.
 * Un fichier absent est simplement ignoré (la vidéo se rend quand même).
 *
 * - at       : image de départ dans la vidéo complète (30 fps)
 * - volume   : 0–1
 * - rate     : vitesse de lecture (1 = normale ; > 1 plus court), hauteur conservée
 * - pitch    : hauteur (1 = normale ; 0,8 plus grave ; 1,2 plus aigu), appliquée au rendu
 * - trim     : secondes coupées au début du fichier (pour caler l'attaque)
 * - duration : durée maximale jouée, en secondes (fondu de sortie automatique)
 * - fadeOut  : durée du fondu de sortie, en secondes (0,25 par défaut)
 */
export type Cue = {file: string; at: number; volume: number; rate?: number; pitch?: number; trim?: number; duration?: number; fadeOut?: number};

/** Pic du whoosh : 0,85 s après le début du fichier (0,55 s après la coupe de 0,3 s). */
const WHOOSH_PEAK = 0.55;
/** Whoosh dont le pic tombe sur le cut d'une transition. */
const whoosh = (cut: number, volume: number, rate = 1): Cue => ({
	file: 'whoosh.mp3',
	at: cut - Math.round((WHOOSH_PEAK * 30) / rate) - 2,
	volume,
	rate,
	trim: 0.3,
	duration: 1.4,
});

/** Gouttes de la scène 2 : mêmes calculs que FallingDrops (impact au sol). */
const dropLandings = [0, 1, 2, 3, 4].map((i) => SCENES.problem.from + Math.round(-8 + i * 9 + random(`dd${i}`) * 6 + 34));

export const SFX: Cue[] = [
	// 1. Accroche : clic de la LED, montée pendant le tracé, impact sous le titre
	{file: 'led-on.mp3', at: 0, volume: 0.55},
	{file: 'riser.mp3', at: 0, volume: 0.55, rate: 1.9, duration: 1},
	{file: 'impact.mp3', at: 24, volume: 0.8, duration: 3},

	// Transitions : le pic du whoosh tombe sur le cut
	whoosh(SCENES.problem.from, 0.55),
	whoosh(SCENES.patch.from, 0.5, 1.1),
	whoosh(SCENES.bottle.from, 0.55, 0.9),
	whoosh(SCENES.app.from, 0.5, 1.05),
	whoosh(SCENES.outro.from, 0.55, 0.9),

	// 2. Problème : montée sur le compteur 1,5 L, gouttes, basse sur « Boire trop tard »
	{file: 'riser.mp3', at: 124, volume: 0.4, rate: 1.4, duration: 1.4},
	...dropLandings.map((at, i): Cue => ({file: 'pop.mp3', at, volume: 0.22 - i * 0.025, pitch: [0.72, 0.85, 0.66, 0.8, 0.7][i]})),
	{file: 'bass.mp3', at: 200, volume: 0.3, duration: 1.6, fadeOut: 0.7},

	// 3. Patch : ondes sonar, libellés qui apparaissent
	{file: 'sonar.mp3', at: 304, volume: 0.35, duration: 1.5},
	{file: 'sonar.mp3', at: 344, volume: 0.22, duration: 1.5},
	{file: 'sonar.mp3', at: 384, volume: 0.14, duration: 1.5},
	{file: 'pop.mp3', at: 343, volume: 0.4},
	{file: 'pop.mp3', at: 355, volume: 0.4, pitch: 1.12},
	{file: 'pop.mp3', at: 367, volume: 0.4, pitch: 1.25},

	// 4. Gourde : bips synchronisés avec la LED, puis redosage
	{file: 'bip.mp3', at: 476, volume: 0.4},
	{file: 'bip.mp3', at: 496, volume: 0.4},
	{file: 'bip.mp3', at: 516, volume: 0.4},
	{file: 'riser.mp3', at: 546, volume: 0.3, rate: 0.8, duration: 2.2, fadeOut: 0.5},
	{file: 'liquid.mp3', at: 550, volume: 0.4, duration: 2.4, fadeOut: 0.6},

	// 5. Appli : liaison Bluetooth (bips rapides), jauge, validation à 78 %
	{file: 'bip.mp3', at: 646, volume: 0.16, pitch: 1.5},
	{file: 'bip.mp3', at: 650, volume: 0.13, pitch: 1.5},
	{file: 'riser.mp3', at: 657, volume: 0.4, rate: 0.95, duration: 1.85},
	{file: 'pop.mp3', at: 712, volume: 0.4, pitch: 1.3},
	{file: 'bip.mp3', at: 714, volume: 0.2, pitch: 1.2},

	// 6. Clôture : impact grave et long sous la signature
	{file: 'impact.mp3', at: 815, volume: 0.7, rate: 0.85, pitch: 0.8, duration: 2.8, fadeOut: 0.8},
	{file: 'bass.mp3', at: 815, volume: 0.12, pitch: 0.85, duration: 1.4, fadeOut: 0.8},
];

/**
 * Gain master appliqué au rendu (+4,5 dB) : ≈ -16 LUFS, crêtes ≤ -2 dBFS.
 * Dans le studio, le volume est plafonné à 1 (limite du navigateur).
 */
export const MASTER_GAIN = 1.68;

/** Volume de la musique de fond quand des bruitages sont présents (sinon 0,8). */
export const MUSIC_VOLUME_WITH_SFX = 0.4;

