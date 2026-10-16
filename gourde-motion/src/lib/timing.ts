// Toutes les durées sont en images (30 fps). Modifier ici pour retimer la vidéo.
export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);

/** Durée des transitions (chevauchement entre deux scènes). */
export const TRANSITION = 12;

export type SceneId = 'hook' | 'problem' | 'patch' | 'bottle' | 'app' | 'outro';

/** Découpage du storyboard : début et durée de chaque scène. */
export const SCENES: Record<SceneId, {from: number; duration: number}> = {
	hook: {from: sec(0), duration: sec(4)}, // 0–4 s    Accroche
	problem: {from: sec(4), duration: sec(5)}, // 4–9 s    Problème
	patch: {from: sec(9), duration: sec(6)}, // 9–15 s   Le patch
	bottle: {from: sec(15), duration: sec(6)}, // 15–21 s  La gourde
	app: {from: sec(21), duration: sec(5)}, // 21–26 s  L'appli
	outro: {from: sec(26), duration: sec(4)}, // 26–30 s  Clôture
};

export const TOTAL_DURATION = sec(30);

/** Image de la scène 4 utilisée pour la miniature PNG (≈ 16,7 s). */
export const THUMBNAIL_FRAME = SCENES.bottle.from + 50;
