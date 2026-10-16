import {sec} from './timing';

/**
 * Sound design : chaque repère joue un fichier de public/sfx/ à une image donnée.
 * Un fichier absent est simplement ignoré (la vidéo se rend quand même).
 *
 * - at       : image de départ dans la vidéo complète (30 fps)
 * - volume   : 0–1
 * - rate     : vitesse de lecture (1 = normale ; > 1 plus court et plus aigu)
 * - trim     : secondes coupées au début du fichier (pour caler l'attaque)
 * - duration : durée maximale jouée, en secondes (fondu de sortie automatique)
 */
export type Cue = {file: string; at: number; volume: number; rate?: number; trim?: number; duration?: number; fadeOut?: number};

export const SFX: Cue[] = [
	// 1. Accroche
	{file: 'led-on.mp3', at: 0, volume: 0.5},
	{file: 'riser.mp3', at: 4, volume: 0.3, duration: 1.1},
	{file: 'impact.mp3', at: 26, volume: 0.7, duration: 2.5},
	// Transitions (le wipe commence 12 images avant le cut)
	{file: 'whoosh.mp3', at: sec(4) - 12, volume: 0.5},
	{file: 'whoosh.mp3', at: sec(9) - 12, volume: 0.45, rate: 1.1},
	{file: 'whoosh.mp3', at: sec(15) - 10, volume: 0.5, rate: 0.9},
	{file: 'whoosh.mp3', at: sec(21) - 12, volume: 0.45, rate: 1.05},
	{file: 'whoosh.mp3', at: sec(26) - 12, volume: 0.5, rate: 0.85},
	// 2. Problème : compteur, gouttes, phrase choc
	{file: 'riser.mp3', at: 124, volume: 0.25, duration: 1.4},
	{file: 'drop.mp3', at: 150, volume: 0.45},
	{file: 'drop.mp3', at: 172, volume: 0.35, rate: 1.15},
	{file: 'drop.mp3', at: 194, volume: 0.3, rate: 0.9},
	{file: 'impact.mp3', at: 202, volume: 0.55, rate: 0.9, duration: 2},
	// 3. Patch : ondes + libellés
	{file: 'sonar.mp3', at: 304, volume: 0.35, duration: 1.5},
	{file: 'sonar.mp3', at: 344, volume: 0.25, duration: 1.5},
	{file: 'sonar.mp3', at: 384, volume: 0.18, duration: 1.5},
	{file: 'pop.mp3', at: 342, volume: 0.45},
	{file: 'pop.mp3', at: 354, volume: 0.45, rate: 1.1},
	{file: 'pop.mp3', at: 366, volume: 0.45, rate: 1.2},
	// 4. Gourde : bips synchronisés avec la LED, puis redosage
	{file: 'bip.mp3', at: 476, volume: 0.45},
	{file: 'bip.mp3', at: 496, volume: 0.45},
	{file: 'bip.mp3', at: 516, volume: 0.45},
	{file: 'liquid.mp3', at: 550, volume: 0.4, duration: 2.4, fadeOut: 0.6},
	// 5. Appli : téléphone, liaison Bluetooth, jauge, validation
	{file: 'data.mp3', at: 646, volume: 0.3, duration: 1.2},
	{file: 'riser.mp3', at: 652, volume: 0.3, duration: 2},
	{file: 'success.mp3', at: 712, volume: 0.45},
	// 6. Clôture
	{file: 'outro.mp3', at: 816, volume: 0.65, fadeOut: 1},
];

/** Volume de la musique de fond quand des bruitages sont présents (sinon 0,8). */
export const MUSIC_VOLUME_WITH_SFX = 0.4;
