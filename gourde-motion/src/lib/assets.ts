import {staticFile} from 'remotion';

/** Images fournies et repères (en pixels source) mesurés dessus. */
export const AFFICHE = {
	src: staticFile('affiche.jpg'),
	w: 1116,
	h: 2000,
	patch: {x: 775, y: 1150},
	bottle: {x: 600, y: 1080},
	splashLeft: {x: 230, y: 1250},
};

export const PRODUIT = {
	src: staticFile('produit.png'),
	w: 2000,
	h: 1115,
	/** Gourde détourée (PNG transparent), origine dans produit.png. */
	bottleCut: {src: staticFile('cutouts/bottle.png'), x: 1110, y: 60, w: 380, h: 960},
	/** Smartphone détouré (PNG transparent), origine dans produit.png. */
	phoneCut: {src: staticFile('cutouts/phone.png'), x: 800, y: 450, w: 300, h: 550},
	/** LED verticale de la gourde. */
	led: {x: 1222, y1: 462, y2: 718},
	/** Bouton/module de connectivité. */
	button: {x: 1222, y: 390},
	/** Patch posé sur la gourde. */
	bottlePatch: {x: 1408, y: 545},
	/** Jauge circulaire de l'appli. */
	gauge: {cx: 956.5, cy: 640, r: 63, stroke: 8, startDeg: 212, sweepDeg: 296},
	/** Fond de la carte de l'appli, pour masquer la jauge d'origine. */
	gaugeCover: {x: 874, y: 566, w: 166, h: 162, color: 'rgb(16,32,46)'},
};
