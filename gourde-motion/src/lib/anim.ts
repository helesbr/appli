import {Easing, interpolate, spring} from 'remotion';

export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);
export const easeOutExpo = Easing.out(Easing.exp);
export const easeIn = Easing.in(Easing.cubic);

/** interpolate() borné, avec easing (jamais linéaire). */
export const tween = (
	frame: number,
	[start, end]: [number, number],
	[from, to]: [number, number],
	easing: (t: number) => number = easeOut,
) =>
	interpolate(frame, [start, end], [from, to], {
		easing,
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

/** Apparition puis disparition : 0 → 1 → 0. */
export const inOut = (frame: number, inStart: number, outEnd: number, fadeIn = 12, fadeOut = 10) =>
	Math.min(
		tween(frame, [inStart, inStart + fadeIn], [0, 1]),
		tween(frame, [outEnd - fadeOut, outEnd], [1, 0], easeIn),
	);

/** Ressort standard du projet. */
export const pop = (frame: number, fps: number, delay = 0, damping = 16, mass = 0.8) =>
	spring({frame: frame - delay, fps, config: {damping, mass, stiffness: 140}});
