import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Background} from '../components/Background';
import {GlowFilter, LedStroke} from '../components/Glow';
import {COLORS, BODY, TITLE} from '../lib/theme';
import {easeInOut, easeOut, pop, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

/** 0–4 s · Accroche : la ligne LED se trace, puis le titre sort de derrière. */
export const Scene1Hook: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, fps, portrait} = useLayout();

	const lineY = portrait ? H * 0.53 : H * 0.6;
	const half = portrait ? W * 0.4 : W * 0.34;
	const cx = W / 2;

	// 1. Point LED qui s'allume, 2. ligne qui se trace des deux côtés.
	const dot = pop(f, fps, 0, 12, 0.6);
	const trace = tween(f, [6, 34], [0, 1], easeInOut);
	const breathe = 0.85 + 0.15 * Math.sin(f / 7);

	// Titre qui monte de derrière la ligne, sous-titre qui descend.
	const titleP = pop(f, fps, 24, 17, 0.8);
	const subP = pop(f, fps, 42, 18, 0.8);
	const zoom = tween(f, [0, 120], [1, 1.045], easeInOut);
	const titleSize = portrait ? 250 : 236;
	const titleLines = portrait ? ['GOURDE', 'CONNECTÉE'] : ['GOURDE CONNECTÉE'];
	const titleH = titleSize * 0.95 * titleLines.length;

	return (
		<AbsoluteFill>
			<Background glowY={lineY / H * 100} />
			<AbsoluteFill style={{transform: `scale(${zoom})`}}>
				{/* Titre, masqué sous la ligne */}
				<div style={{position: 'absolute', left: 0, width: W, top: lineY - titleH - 30, height: titleH + 18, overflow: 'hidden'}}>
					<div
						style={{
							fontFamily: TITLE,
							fontSize: titleSize,
							lineHeight: 0.95,
							color: COLORS.white,
							textAlign: 'center',
							letterSpacing: '0.015em',
							transform: `translateY(${(1 - titleP) * 140}%)`,
							textShadow: '0 6px 40px rgba(0,0,0,0.35)',
						}}
					>
						{titleLines.map((l) => (
							<div key={l}>{l}</div>
						))}
					</div>
				</div>

				{/* Sous-titre, masqué au-dessus de la ligne */}
				<div style={{position: 'absolute', left: 0, width: W, top: lineY + 22, height: 90, overflow: 'hidden'}}>
					<div
						style={{
							fontFamily: BODY,
							fontWeight: 700,
							fontSize: portrait ? 40 : 38,
							letterSpacing: '0.42em',
							paddingLeft: '0.42em',
							color: COLORS.cyanIce,
							textAlign: 'center',
							transform: `translateY(${(subP - 1) * 220}%)`,
							marginTop: 14,
						}}
					>
						DECATHLON CMA CGM TEAM
					</div>
				</div>

				{/* Ligne LED */}
				<svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
					<GlowFilter id="hookglow" blur={10} />
					<LedStroke d={`M ${cx} ${lineY} L ${cx + half} ${lineY}`} progress={trace} width={6} filterId="hookglow" opacity={breathe} />
					<LedStroke d={`M ${cx} ${lineY} L ${cx - half} ${lineY}`} progress={trace} width={6} filterId="hookglow" opacity={breathe} />
					<circle cx={cx} cy={lineY} r={10 * dot * (1 - trace * 0.5)} fill="#F0FDFF" filter="url(#hookglow)" opacity={tween(f, [0, 4], [0, 1], easeOut)} />
				</svg>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
