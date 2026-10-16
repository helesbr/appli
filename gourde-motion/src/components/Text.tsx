import React from 'react';
import {COLORS, BODY, TITLE} from '../lib/theme';
import {pop, tween, easeIn} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

type Line = string | {text: string; color?: string};

/**
 * Titre en texte cinétique : chaque mot monte derrière un masque, en cascade.
 * Les lignes sont fournies explicitement (contrôle des césures en 16:9 et 9:16).
 */
export const KineticTitle: React.FC<{
	lines: Line[][] | Line[];
	start: number;
	end?: number;
	size: number;
	stagger?: number;
	align?: 'left' | 'center';
	color?: string;
	lineHeight?: number;
	style?: React.CSSProperties;
}> = ({lines, start, end, size, stagger = 3, align = 'left', color = COLORS.white, lineHeight = 0.92, style}) => {
	const f = useSceneFrame();
	const {fps} = useLayout();
	const rows: Line[][] = (lines as unknown[]).map((l) => (Array.isArray(l) ? (l as Line[]) : [l as Line]));
	let idx = 0;
	const exit = end === undefined ? 0 : tween(f, [end - 10, end], [0, 1], easeIn);
	return (
		<div
			style={{
				fontFamily: TITLE,
				fontSize: size,
				lineHeight,
				color,
				textAlign: align,
				letterSpacing: '0.01em',
				opacity: 1 - exit,
				transform: `translateY(${-exit * 30}px)`,
				...style,
			}}
		>
			{rows.map((row, r) => (
				<div key={r} style={{display: 'flex', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: '0 0.22em', flexWrap: 'nowrap'}}>
					{row.flatMap((seg, si) => {
						const s = typeof seg === 'string' ? {text: seg} : seg;
						return s.text.split(' ').map((word, wi) => {
							const p = pop(f, fps, start + idx++ * stagger, 18, 0.7);
							return (
								<span key={`${si}-${wi}`} style={{display: 'inline-block', overflow: 'hidden', padding: '0.06em 0 0.02em', marginBottom: '-0.08em'}}>
									<span
										style={{
											display: 'inline-block',
											color: s.color ?? color,
											transform: `translateY(${(1 - p) * 140}%)`,
										}}
									>
										{word}
									</span>
								</span>
							);
						});
					})}
				</div>
			))}
		</div>
	);
};

/** Surtitre (numéro d'étape + verbe), petit, espacé. */
export const Kicker: React.FC<{text: string; start: number; end?: number; style?: React.CSSProperties}> = ({text, start, end, style}) => {
	const f = useSceneFrame();
	const o = Math.min(tween(f, [start, start + 12], [0, 1]), end === undefined ? 1 : tween(f, [end - 10, end], [1, 0], easeIn));
	const w = tween(f, [start, start + 18], [0, 1]);
	return (
		<div style={{display: 'flex', alignItems: 'center', gap: 18, opacity: o, ...style}}>
			<div style={{height: 3, width: 54 * w, background: COLORS.cyanBright, boxShadow: `0 0 12px ${COLORS.cyan}`, borderRadius: 2}} />
			<div style={{fontFamily: BODY, fontWeight: 700, fontSize: 26, letterSpacing: '0.32em', color: COLORS.cyanIce, textTransform: 'uppercase', transform: `translateX(${(1 - w) * -20}px)`}}>
				{text}
			</div>
		</div>
	);
};

/** Texte court (Lato) avec fondu montant. */
export const Body: React.FC<{
	children: React.ReactNode;
	start: number;
	end?: number;
	size?: number;
	color?: string;
	weight?: number;
	align?: 'left' | 'center';
	style?: React.CSSProperties;
}> = ({children, start, end, size = 34, color = COLORS.mist, weight = 400, align = 'left', style}) => {
	const f = useSceneFrame();
	const o = Math.min(tween(f, [start, start + 14], [0, 1]), end === undefined ? 1 : tween(f, [end - 10, end], [1, 0], easeIn));
	const y = tween(f, [start, start + 18], [24, 0]);
	return (
		<div style={{fontFamily: BODY, fontSize: size, fontWeight: weight, color, lineHeight: 1.35, textAlign: align, opacity: o, transform: `translateY(${y}px)`, ...style}}>
			{children}
		</div>
	);
};
