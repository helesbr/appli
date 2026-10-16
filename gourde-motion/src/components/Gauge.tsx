import React from 'react';
import {MapFn} from './ImageCrop';
import {PRODUIT} from '../lib/assets';
import {BODY, COLORS} from '../lib/theme';

/**
 * Remplace la jauge de l'écran du smartphone (produit.png) par une jauge animée.
 * À utiliser comme enfant d'un ImageCrop sur produit.png.
 */
export const PhoneGauge: React.FC<{map: MapFn; s: number; value: number}> = ({map, s, value}) => {
	const g = PRODUIT.gauge;
	const cov = PRODUIT.gaugeCover;
	const [cx, cy] = map(g.cx, g.cy);
	const [x0, y0] = map(cov.x, cov.y);
	const r = g.r * s;
	const sw = g.stroke * s;
	const pt = (deg: number): [number, number] => {
		const a = ((deg - 90) * Math.PI) / 180; // 0° = midi, sens horaire
		return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
	};
	const arcPath = (sweep: number) => {
		const [ax, ay] = pt(g.startDeg);
		const [bx, by] = pt(g.startDeg + sweep);
		return `M ${ax} ${ay} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${bx} ${by}`;
	};
	const sweep = Math.max(0.01, (g.sweepDeg * value) / 100);
	return (
		<>
			<div style={{position: 'absolute', left: x0, top: y0, width: cov.w * s, height: cov.h * s, background: cov.color, borderRadius: 6 * s}} />
			<svg style={{position: 'absolute', inset: 0, overflow: 'visible'}} width="100%" height="100%">
				<defs>
					<linearGradient id="gaugegrad" x1="0" y1="1" x2="1" y2="0">
						<stop offset="0" stopColor="#38BDF8" />
						<stop offset="1" stopColor={COLORS.cyanBright} />
					</linearGradient>
				</defs>
				<path d={arcPath(g.sweepDeg)} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth={sw} strokeLinecap="round" />
				<path d={arcPath(sweep)} fill="none" stroke="url(#gaugegrad)" strokeWidth={sw} strokeLinecap="round" style={{filter: `drop-shadow(0 0 ${4 * s}px rgba(34,211,238,0.8))`}} />
			</svg>
			<div style={{position: 'absolute', left: cx - r, width: r * 2, top: cy - 22 * s, textAlign: 'center', fontFamily: BODY, fontWeight: 300, fontSize: 34 * s, lineHeight: 1, color: COLORS.white, fontVariantNumeric: 'tabular-nums'}}>
				{Math.round(value)}%
			</div>
			<div style={{position: 'absolute', left: cx - r, width: r * 2, top: cy + 22 * s, textAlign: 'center', fontFamily: BODY, fontSize: 8.5 * s, color: '#9FB3C8', whiteSpace: 'nowrap'}}>
				Niveau d'hydratation
			</div>
		</>
	);
};
