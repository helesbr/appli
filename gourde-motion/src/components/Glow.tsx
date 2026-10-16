import React from 'react';
import {COLORS} from '../lib/theme';

/** Filtre SVG de lueur (à placer dans un <svg>). */
export const GlowFilter: React.FC<{id: string; blur?: number}> = ({id, blur = 8}) => (
	<defs>
		<filter id={id} x="-100%" y="-100%" width="300%" height="300%">
			<feGaussianBlur stdDeviation={blur} result="b" />
			<feMerge>
				<feMergeNode in="b" />
				<feMergeNode in="b" />
				<feMergeNode in="SourceGraphic" />
			</feMerge>
		</filter>
	</defs>
);

/** Ligne LED : trait cyan + cœur clair, avec lueur. */
export const LedStroke: React.FC<{
	d: string;
	progress: number;
	width?: number;
	filterId: string;
	opacity?: number;
}> = ({d, progress, width = 6, filterId, opacity = 1}) => progress <= 0.001 ? null : (
	<g opacity={opacity}>
		<path d={d} pathLength={1} fill="none" stroke={COLORS.cyan} strokeWidth={width * 3} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - progress} filter={`url(#${filterId})`} opacity={0.85} />
		<path d={d} pathLength={1} fill="none" stroke={COLORS.cyanBright} strokeWidth={width} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - progress} />
		<path d={d} pathLength={1} fill="none" stroke="#F0FDFF" strokeWidth={width * 0.4} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - progress} />
	</g>
);
