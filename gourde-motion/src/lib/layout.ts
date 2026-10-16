import {createContext, useContext} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

/** Format courant : paysage (16:9) ou portrait (9:16). */
export const useLayout = () => {
	const {width: W, height: H, fps} = useVideoConfig();
	const portrait = H > W;
	return {W, H, fps, portrait};
};

/**
 * Chaque scène démarre TRANSITION images avant son début nominal (pour la
 * transition). useSceneFrame() renvoie le temps relatif au début nominal :
 * négatif pendant la transition d'entrée, 0 au moment du « cut ».
 */
export const SceneOffset = createContext(0);
export const useSceneFrame = () => useCurrentFrame() - useContext(SceneOffset);
