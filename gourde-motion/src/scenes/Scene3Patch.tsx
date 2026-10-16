import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Vignette} from '../components/Background';
import {GlowFilter} from '../components/Glow';
import {ImageCamera, cameraCrop} from '../components/ImageCrop';
import {Body, Kicker, KineticTitle} from '../components/Text';
import {AFFICHE} from '../lib/assets';
import {COLORS, BODY} from '../lib/theme';
import {easeInOut, easeOut, pop, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

const LABELS = ['Électrolytes', 'Osmolarité', 'pH'];

/** 9–15 s · Le patch : zoom sur le patch HydroSense, ondes, puis les mesures. */
export const Scene3Patch: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, fps, portrait} = useLayout();

	// Caméra : plan large sur l'affiche → gros plan sur le patch.
	const z = tween(f, [-12, 140], [0, 1], easeInOut);
	const target = portrait ? {sx: W * 0.5, sy: H * 0.36} : {sx: W * 0.64, sy: H * 0.47};
	const scale = portrait ? 1.05 + z * 1.25 : 1.75 + z * 1.15;
	const fx = AFFICHE.patch.x + (1 - z) * (portrait ? -180 : -120);
	const fy = AFFICHE.patch.y + (1 - z) * (portrait ? -60 : 40);
	const cam = {fx, fy, sx: target.sx, sy: target.sy, scale};
	const proj = cameraCrop(cam, W, H, AFFICHE.w, AFFICHE.h);
	const [px, py] = proj.toScreen(AFFICHE.patch.x, AFFICHE.patch.y);
	const patchHalf = 78 * proj.scale;

	return (
		<AbsoluteFill style={{background: COLORS.night}}>
			<ImageCamera src={AFFICHE.src} imgW={AFFICHE.w} imgH={AFFICHE.h} W={W} H={H} cam={cam} grade={0.25} imgStyle={{filter: `brightness(${0.95 - z * 0.15})`}} />
			{/* Voile pour la lisibilité du texte */}
			<AbsoluteFill
				style={{
					background: portrait
						? 'linear-gradient(180deg, rgba(11,27,46,0.55) 0%, rgba(11,27,46,0) 22%, rgba(11,27,46,0) 44%, rgba(11,27,46,0.9) 58%, rgba(11,27,46,0.98) 100%)'
						: 'linear-gradient(90deg, rgba(11,27,46,0.97) 0%, rgba(11,27,46,0.88) 32%, rgba(11,27,46,0.2) 52%, rgba(11,27,46,0) 70%)',
				}}
			/>
			<Vignette strength={0.5} />

			{/* Ondes cyan émises par le patch */}
			<AbsoluteFill>
				<svg width={W} height={H}>
					<GlowFilter id="waveglow" blur={6} />
					{new Array(6).fill(0).map((_, i) => {
						const t = f - (34 + i * 20);
						if (t < 0) return null;
						const p = tween(t, [0, 60], [0, 1], easeOut);
						return (
							<rect
								key={i}
								x={px - patchHalf - p * 340}
								y={py - patchHalf - p * 340}
								width={(patchHalf + p * 340) * 2}
								height={(patchHalf + p * 340) * 2}
								rx={patchHalf * 0.45 + p * 340}
								fill="none"
								stroke={COLORS.cyanBright}
								strokeWidth={3}
								opacity={(1 - p) * 0.85}
								filter="url(#waveglow)"
							/>
						);
					})}
					{/* Contour lumineux du patch */}
					<rect
						x={px - patchHalf}
						y={py - patchHalf}
						width={patchHalf * 2}
						height={patchHalf * 2}
						rx={patchHalf * 0.42}
						fill="none"
						stroke={COLORS.cyanBright}
						strokeWidth={3}
						opacity={tween(f, [24, 40], [0, 0.9], easeOut) * (0.75 + 0.25 * Math.sin(f / 5))}
						filter="url(#waveglow)"
						transform={`rotate(-8 ${px} ${py})`}
					/>
					<Callouts px={px} py={py} half={patchHalf} />
				</svg>
			</AbsoluteFill>

			{/* Libellés des mesures */}
			{LABELS.map((label, i) => {
				const pos = labelPos(i, px, py, patchHalf, portrait);
				const p = pop(f, fps, 72 + i * 12, 15, 0.7);
				return (
					<div
						key={label}
						style={{
							position: 'absolute',
							left: pos.x,
							top: pos.y,
							transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * p})`,
							opacity: Math.min(1, p * 1.4),
							padding: '14px 30px',
							borderRadius: 999,
							border: `2px solid ${COLORS.cyanBright}`,
							background: 'rgba(11,27,46,0.82)',
							boxShadow: `0 0 24px rgba(34,211,238,0.35)`,
							fontFamily: BODY,
							fontWeight: 700,
							fontSize: portrait ? 36 : 34,
							color: COLORS.white,
							whiteSpace: 'nowrap',
						}}
					>
						{label}
					</div>
				);
			})}

			{/* Texte */}
			<div
				style={{
					position: 'absolute',
					left: portrait ? 80 : 120,
					right: portrait ? 80 : undefined,
					top: portrait ? H * 0.6 : H * 0.3,
					width: portrait ? undefined : W * 0.36,
				}}
			>
				<Kicker text="01 · Mesurer" start={6} />
				<KineticTitle lines={[['LE PATCH'], ['HYDROSENSE']]} start={12} size={portrait ? 150 : 150} style={{marginTop: 22}} />
				<Body start={30} size={portrait ? 40 : 36} style={{marginTop: 26, maxWidth: portrait ? 900 : 620}}>
					Il analyse la sueur et mesure l'hydratation du coureur en continu.
				</Body>
			</div>
		</AbsoluteFill>
	);
};

const labelPos = (i: number, px: number, py: number, half: number, portrait: boolean) => {
	if (portrait) {
		const xs = [-310, 0, 310];
		const ys = [half + 120, half + 210, half + 120];
		return {x: px + xs[i], y: py + ys[i]};
	}
	const ys = [-half - 30, 0, half + 30];
	return {x: px + half + 250, y: py + ys[i]};
};

/** Filets reliant le patch aux libellés. */
const Callouts: React.FC<{px: number; py: number; half: number}> = ({px, py, half}) => {
	const f = useSceneFrame();
	const {portrait} = useLayout();
	return (
		<g>
			{LABELS.map((l, i) => {
				const pos = labelPos(i, px, py, half, portrait);
				const p = tween(f, [66 + i * 12, 84 + i * 12], [0, 1], easeOut);
				const sx = portrait ? px + [-0.5, 0, 0.5][i] * half : px + half * 0.9;
				const sy = portrait ? py + half * 0.9 : py + [-0.5, 0, 0.5][i] * half;
				const ex = portrait ? pos.x : pos.x - 110;
				const ey = portrait ? pos.y - 34 : pos.y;
				return (
					<g key={l} opacity={p > 0 ? 1 : 0}>
						<line x1={sx} y1={sy} x2={sx + (ex - sx) * p} y2={sy + (ey - sy) * p} stroke={COLORS.cyanBright} strokeWidth={2} opacity={0.8} />
						<circle cx={sx} cy={sy} r={6} fill={COLORS.cyanBright} />
					</g>
				);
			})}
		</g>
	);
};
