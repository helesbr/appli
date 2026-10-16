import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {COLORS} from '../lib/theme';
import {useLayout, useSceneFrame} from '../lib/layout';

/** Fond bleu nuit, halo central et vignette. */
export const Background: React.FC<{glowX?: number; glowY?: number; particles?: boolean}> = ({
	glowX = 50,
	glowY = 42,
	particles = true,
}) => (
	<AbsoluteFill
		style={{
			background: `radial-gradient(ellipse 70% 60% at ${glowX}% ${glowY}%, #163A60 0%, ${COLORS.navy} 45%, ${COLORS.night} 100%)`,
		}}
	>
		{particles ? <Particles /> : null}
		<Vignette />
	</AbsoluteFill>
);

export const Vignette: React.FC<{strength?: number}> = ({strength = 0.55}) => (
	<AbsoluteFill
		style={{
			background: `radial-gradient(ellipse 85% 85% at 50% 50%, rgba(0,0,0,0) 55%, rgba(4,12,22,${strength}) 100%)`,
			pointerEvents: 'none',
		}}
	/>
);

/** Fines particules cyan (gouttelettes en suspension), déterministes. */
export const Particles: React.FC<{count?: number}> = ({count = 34}) => {
	const f = useSceneFrame();
	const {W, H} = useLayout();
	return (
		<AbsoluteFill>
			<svg width={W} height={H}>
				{new Array(count).fill(0).map((_, i) => {
					const x0 = random(`px${i}`) * W;
					const y0 = random(`py${i}`) * H;
					const speed = 0.25 + random(`ps${i}`) * 0.6;
					const r = 1 + random(`pr${i}`) * 2.4;
					const y = (((y0 - (f + 40) * speed) % H) + H) % H;
					const x = x0 + Math.sin((f + i * 17) / 40) * 10;
					const o = 0.12 + random(`po${i}`) * 0.3;
					return <circle key={i} cx={x} cy={y} r={r} fill={COLORS.cyanBright} opacity={o} />;
				})}
			</svg>
		</AbsoluteFill>
	);
};
