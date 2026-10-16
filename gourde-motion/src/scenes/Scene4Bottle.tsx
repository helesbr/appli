import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Background} from '../components/Background';
import {Bottle} from '../components/Bottle';
import {GlowFilter} from '../components/Glow';
import {Body, Kicker, KineticTitle} from '../components/Text';
import {PRODUIT} from '../lib/assets';
import {COLORS, BODY} from '../lib/theme';
import {easeIn, easeInOut, easeOut, pop, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

const PART_B = 92; // passage « alerte » → « redosage »
const FLOWS = [
	{label: 'Eau', color: '#38BDF8'},
	{label: 'Sels minéraux', color: '#E2E8F0'},
	{label: 'Glucides', color: COLORS.orange},
];
/** Bips (images, relatives au début de la scène). */
const BEEPS = [26, 46, 66];

/** 15–21 s · La gourde : LED qui pulse, bip, puis redosage automatique. */
export const Scene4Bottle: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, fps, portrait} = useLayout();

	// Gourde : entrée + rotation légère + flottement.
	const enter = pop(f, fps, -10, 18, 0.9);
	const rot = tween(f, [-12, 180], [-7, 3], easeInOut);
	const float = Math.sin(f / 18) * 8;
	const bottleH = portrait ? H * 0.46 : H * 0.96;
	const c = PRODUIT.bottleCut;
	const bottleW = (bottleH * c.w) / c.h;
	const bx = portrait ? W * 0.5 : W * 0.7; // centre
	const by = portrait ? H * 0.28 : H * 0.5;

	// LED : pulsations synchronisées avec les bips, puis lueur stable.
	const pulse = BEEPS.reduce((acc, b) => Math.max(acc, tween(f, [b, b + 4], [0, 1], easeOut) * tween(f, [b + 4, b + 18], [1, 0], easeOut)), 0);
	const steady = tween(f, [PART_B, PART_B + 30], [0, 0.7], easeOut);
	const led = Math.max(0.25 + pulse * 1.1, steady + 0.25 * Math.sin(f / 6) * (f > PART_B ? 1 : 0));

	const s = bottleH / c.h;
	const toScreen = (x: number, y: number): [number, number] => {
		// approximation sans rotation (rotation faible) pour placer les overlays
		const lx = (x - c.x) * s - bottleW / 2;
		const ly = (y - c.y) * s - bottleH / 2;
		const r = (rot * Math.PI) / 180;
		return [bx + lx * Math.cos(r) - ly * Math.sin(r), by + float + lx * Math.sin(r) + ly * Math.cos(r)];
	};
	const [btnX, btnY] = toScreen(PRODUIT.button.x, PRODUIT.button.y);
	const [inX, inY] = toScreen(1200, 560);

	// Badge « bip »
	const badge = pop(f, fps, BEEPS[0] - 6, 14, 0.7);
	const badgeOut = tween(f, [PART_B - 10, PART_B], [1, 0], easeIn);
	const badgeX = portrait ? bx - bottleW * 0.62 : bx - bottleW * 0.78;
	const badgeY = btnY - 30;

	const textLeft = portrait ? 80 : 120;
	const textTop = portrait ? H * 0.6 : H * 0.24;

	// Pastilles de légende (point de départ des flux)
	const chipPos = (i: number) =>
		portrait ? {x: W * (0.2 + i * 0.3), y: H * 0.555} : {x: textLeft, y: H * 0.56 + i * 92};

	return (
		<AbsoluteFill>
			<Background glowX={portrait ? 50 : 68} glowY={portrait ? 32 : 48} />

			{/* Flux de couleur (sous la gourde) */}
			<AbsoluteFill>
				<svg width={W} height={H}>
					<GlowFilter id="flowglow" blur={7} />
					{FLOWS.map((fl, i) => {
						const p = tween(f, [PART_B + 8 + i * 6, PART_B + 48 + i * 6], [0, 1], easeInOut);
						if (p <= 0) return null;
						const cp = chipPos(i);
						const sx = portrait ? cp.x : cp.x + chipWidth(fl.label) + 26;
						const sy = portrait ? cp.y - 40 : cp.y + 33;
						const d = portrait
							? `M ${sx} ${sy} C ${sx} ${sy - 120}, ${inX} ${inY + 260}, ${inX} ${inY + 120}`
							: `M ${sx} ${sy} C ${sx + 260} ${sy}, ${inX - 280} ${inY}, ${inX} ${inY}`;
						return (
							<g key={fl.label}>
								<path d={d} pathLength={1} fill="none" stroke={fl.color} strokeWidth={14} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - p} opacity={0.35} filter="url(#flowglow)" />
								<path d={d} pathLength={1} fill="none" stroke={fl.color} strokeWidth={5} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - p} />
								{/* Courant : tirets qui circulent vers la gourde */}
								<path d={d} pathLength={100} fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeDasharray="2 8" strokeDashoffset={-f * 0.9} opacity={p >= 1 ? 0.7 : 0} />
							</g>
						);
					})}
					{/* Point de mélange */}
					<circle cx={inX} cy={portrait ? inY + 120 : inY} r={14 + 10 * Math.sin(f / 4)} fill={COLORS.cyanBright} opacity={tween(f, [PART_B + 50, PART_B + 62], [0, 0.85], easeOut)} filter="url(#flowglow)" />
				</svg>
			</AbsoluteFill>

			{/* Gourde */}
			<div
				style={{
					position: 'absolute',
					left: bx - bottleW / 2,
					top: by - bottleH / 2 + float,
					transform: `rotate(${rot}deg) scale(${0.88 + 0.12 * enter})`,
					opacity: Math.min(1, enter * 1.3),
				}}
			>
				<Bottle height={bottleH} led={led} />
			</div>

			{/* Ondes sonores autour du bouton + badge bip */}
			<AbsoluteFill style={{opacity: badgeOut}}>
				<svg width={W} height={H}>
					<GlowFilter id="beepglow" blur={5} />
					{BEEPS.map((b) =>
						[0, 1, 2].map((k) => {
							const t = f - b - k * 3;
							if (t < 0 || t > 26) return null;
							const p = tween(t, [0, 26], [0, 1], easeOut);
							const r = 40 + p * 120 + k * 10;
							return (
								<g key={`${b}-${k}`} opacity={(1 - p) * 0.9}>
									<path d={arc(btnX, btnY, r, 200, 340)} fill="none" stroke={COLORS.cyanBright} strokeWidth={4} strokeLinecap="round" filter="url(#beepglow)" />
									<path d={arc(btnX, btnY, r, 20, 160)} fill="none" stroke={COLORS.cyanBright} strokeWidth={4} strokeLinecap="round" filter="url(#beepglow)" />
								</g>
							);
						}),
					)}
				</svg>
				<BeepBadge x={badgeX} y={badgeY} p={badge} active={pulse} />
			</AbsoluteFill>

			{/* Texte phase A : alerte */}
			<div style={{position: 'absolute', left: textLeft, right: portrait ? 80 : undefined, top: textTop, width: portrait ? undefined : W * 0.42}}>
				<Kicker text="02 · Alerter" start={2} end={PART_B} />
				<KineticTitle lines={portrait ? [['IL SAIT QUAND'], ['IL DOIT BOIRE']] : [['IL SAIT QUAND'], ['IL DOIT BOIRE']]} start={8} end={PART_B} size={portrait ? 150 : 140} style={{marginTop: 22}} />
				<Body start={22} end={PART_B} size={portrait ? 40 : 36} style={{marginTop: 24, maxWidth: portrait ? 900 : 640}}>
					Voyant LED et bip sonore : l'alerte arrive sans quitter la route des yeux.
				</Body>
			</div>

			{/* Texte phase B : redosage */}
			{f >= PART_B - 2 ? (
				<>
					<div style={{position: 'absolute', left: textLeft, right: portrait ? 80 : undefined, top: portrait ? H * 0.62 : textTop, width: portrait ? undefined : W * 0.42}}>
						<Kicker text="03 · Doser" start={PART_B} />
						<KineticTitle lines={portrait ? [['REDOSAGE'], ['AUTOMATIQUE']] : [['REDOSAGE'], ['AUTOMATIQUE']]} start={PART_B + 4} size={portrait ? 150 : 140} style={{marginTop: 22}} />
						{portrait ? (
							<Body start={PART_B + 18} size={40} style={{marginTop: 24}}>
								La boisson s'adapte à l'état du coureur.
							</Body>
						) : null}
					</div>
					{FLOWS.map((fl, i) => {
						const cp = chipPos(i);
						const p = pop(f, fps, PART_B + 4 + i * 6, 15, 0.7);
						return (
							<div
								key={fl.label}
								style={{
									position: 'absolute',
									left: cp.x,
									top: cp.y,
									transform: portrait ? `translate(-50%, -50%) scale(${0.7 + 0.3 * p})` : `translateX(${(1 - p) * -40}px)`,
									opacity: Math.min(1, p * 1.4),
									display: 'flex',
									alignItems: 'center',
									gap: 16,
									height: 66,
									padding: '0 28px 0 20px',
									borderRadius: 999,
									background: 'rgba(11,27,46,0.85)',
									border: `2px solid ${fl.color}`,
									fontFamily: BODY,
									fontWeight: 700,
									fontSize: portrait ? 32 : 32,
									color: COLORS.white,
									whiteSpace: 'nowrap',
								}}
							>
								<div style={{width: 20, height: 20, borderRadius: 10, background: fl.color, boxShadow: `0 0 12px ${fl.color}`}} />
								{fl.label}
							</div>
						);
					})}
				</>
			) : null}
		</AbsoluteFill>
	);
};

/** Largeur approximative d'une pastille (Lato 700, 32 px). */
const chipWidth = (label: string) => 20 + 20 + 16 + 28 + label.length * 17.5;

const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
	const rad = (a: number) => (a * Math.PI) / 180;
	const x0 = cx + r * Math.cos(rad(a0));
	const y0 = cy + r * Math.sin(rad(a0));
	const x1 = cx + r * Math.cos(rad(a1));
	const y1 = cy + r * Math.sin(rad(a1));
	return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
};

/** Icône « bip » : haut-parleur stylisé et ondes, dans un badge rond. */
const BeepBadge: React.FC<{x: number; y: number; p: number; active: number}> = ({x, y, p, active}) => {
	const size = 120;
	return (
		<div
			style={{
				position: 'absolute',
				left: x - size / 2,
				top: y - size / 2,
				width: size,
				height: size,
				borderRadius: size / 2,
				border: `3px solid ${COLORS.cyanBright}`,
				background: 'rgba(11,27,46,0.88)',
				boxShadow: `0 0 ${20 + active * 30}px rgba(34,211,238,${0.4 + active * 0.5})`,
				transform: `scale(${p * (1 + active * 0.08)})`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<svg width={70} height={70} viewBox="0 0 70 70">
				<path d="M10 27 H22 L36 15 V55 L22 43 H10 Z" fill={COLORS.cyanIce} />
				<path d="M44 26 Q50 35 44 44" fill="none" stroke={COLORS.cyanBright} strokeWidth={4} strokeLinecap="round" opacity={0.5 + active * 0.5} />
				<path d="M51 19 Q62 35 51 51" fill="none" stroke={COLORS.cyanBright} strokeWidth={4} strokeLinecap="round" opacity={0.3 + active * 0.7} />
			</svg>
		</div>
	);
};
