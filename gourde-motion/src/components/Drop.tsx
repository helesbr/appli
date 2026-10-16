import React from 'react';
import {COLORS} from '../lib/theme';

/** Goutte stylisée (tracé simple, dégradé cyan), centrée sur (0,0), hauteur ≈ size. */
export const Drop: React.FC<{size: number; id: string; color?: string; opacity?: number}> = ({size, id, color = COLORS.cyanBright, opacity = 1}) => {
	const s = size / 100;
	return (
		<g transform={`scale(${s})`} opacity={opacity}>
			<defs>
				<linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#E6FBFF" stopOpacity={0.95} />
					<stop offset="0.45" stopColor={color} stopOpacity={0.9} />
					<stop offset="1" stopColor={COLORS.cyan} stopOpacity={0.85} />
				</linearGradient>
			</defs>
			<path d="M0,-50 C 6,-34 32,-8 32,16 C 32,36 17,50 0,50 C -17,50 -32,36 -32,16 C -32,-8 -6,-34 0,-50 Z" fill={`url(#${id})`} />
			<path d="M-14,14 C -14,26 -8,34 0,37" fill="none" stroke="#FFFFFF" strokeOpacity={0.75} strokeWidth={5} strokeLinecap="round" />
		</g>
	);
};
