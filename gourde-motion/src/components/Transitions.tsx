import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLORS} from '../lib/theme';
import {easeInOut, easeOut, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';
import {TRANSITION} from '../lib/timing';

export type TransitionKind = 'none' | 'wipe' | 'wipe-reverse' | 'flash' | 'wipe-flash';

/**
 * Transition d'entrée d'une scène. Elle se joue sur les TRANSITION images qui
 * précèdent le début nominal de la scène (useSceneFrame() de -TRANSITION à 0).
 * - wipe : masque diagonal dont le bord est une ligne LED cyan.
 * - flash : éclair cyan qui masque le « cut ».
 */
export const SceneTransition: React.FC<{kind: TransitionKind; children: React.ReactNode}> = ({kind, children}) => {
	const f = useSceneFrame();
	const {W, H} = useLayout();
	if (kind === 'none') return <>{children}</>;

	const isWipe = kind.startsWith('wipe');
	const reverse = kind === 'wipe-reverse';
	const withFlash = kind === 'flash' || kind === 'wipe-flash';

	// Wipe diagonal
	const p = isWipe ? tween(f, [-TRANSITION, 0], [0, 1], easeInOut) : 1;
	const slant = H * 0.42;
	const e = -slant + p * (W + slant * 2); // position du bord (milieu)
	const topX = e + slant / 2;
	const botX = e - slant / 2;
	const clip = p >= 1
		? undefined
		: reverse
			? `polygon(${W - topX}px 0, ${W}px 0, ${W}px ${H}px, ${W - botX}px ${H}px)`
			: `polygon(0 0, ${topX}px 0, ${botX}px ${H}px, 0 ${H}px)`;

	// Flash : montée sur 5 images avant le cut, descente sur 12 après.
	const flash = withFlash
		? Math.min(tween(f, [-5, 0], [0, 1], easeOut), tween(f, [0, 12], [1, 0], easeOut))
		: 0;
	const visible = kind === 'flash' ? (f >= -1 ? 1 : 0) : 1;

	const lineX1 = reverse ? W - topX : topX;
	const lineX2 = reverse ? W - botX : botX;

	return (
		<AbsoluteFill>
			<AbsoluteFill style={{clipPath: clip, opacity: visible}}>{children}</AbsoluteFill>
			{isWipe && p > 0 && p < 1 ? (
				<AbsoluteFill style={{pointerEvents: 'none'}}>
					<svg width={W} height={H}>
						<defs>
							<filter id="ledglow" x="-50%" y="-50%" width="200%" height="200%">
								<feGaussianBlur stdDeviation="10" result="b" />
								<feMerge>
									<feMergeNode in="b" />
									<feMergeNode in="b" />
									<feMergeNode in="SourceGraphic" />
								</feMerge>
							</filter>
						</defs>
						<line x1={lineX1} y1={-20} x2={lineX2} y2={H + 20} stroke={COLORS.cyan} strokeWidth={14} filter="url(#ledglow)" opacity={0.9} />
						<line x1={lineX1} y1={-20} x2={lineX2} y2={H + 20} stroke="#E6FBFF" strokeWidth={4} strokeLinecap="round" />
					</svg>
				</AbsoluteFill>
			) : null}
			{flash > 0 ? (
				<AbsoluteFill
					style={{
						pointerEvents: 'none',
						opacity: flash,
						background: `radial-gradient(ellipse 60% 60% at 50% 50%, rgba(230,251,255,0.95) 0%, rgba(34,211,238,0.85) 35%, rgba(8,145,178,0.55) 70%, rgba(8,145,178,0.25) 100%)`,
						mixBlendMode: 'screen',
					}}
				/>
			) : null}
		</AbsoluteFill>
	);
};
