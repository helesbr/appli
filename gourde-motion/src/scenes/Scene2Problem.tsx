import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {Background} from '../components/Background';
import {Drop} from '../components/Drop';
import {ImageCamera} from '../components/ImageCrop';
import {Body, KineticTitle} from '../components/Text';
import {AFFICHE} from '../lib/assets';
import {COLORS, TITLE} from '../lib/theme';
import {easeIn, easeInOut, easeOut, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

const PART_B = 82; // bascule vers la 2e phrase

/** 4–9 s · Problème : 1,5 L de sueur par heure, puis « boire trop tard… ». */
export const Scene2Problem: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, portrait} = useLayout();

	// Compteur 0,0 → 1,5 L
	const litres = tween(f, [4, 44], [0, 1.5], easeOut);
	const litresText = litres.toFixed(1).replace('.', ',');
	const exitA = tween(f, [PART_B - 12, PART_B], [0, 1], easeIn);

	// Texture : éclaboussure d'eau de l'affiche, en parallaxe lente.
	const pan = tween(f, [-12, 150], [0, 1], easeInOut);

	const bigSize = portrait ? 400 : 380;

	return (
		<AbsoluteFill>
			<Background glowX={portrait ? 50 : 50} glowY={45} />
			<AbsoluteFill style={{opacity: 0.2, mixBlendMode: 'screen', filter: 'saturate(0.7) blur(7px)'}}>
				<ImageCamera
					src={AFFICHE.src}
					imgW={AFFICHE.w}
					imgH={AFFICHE.h}
					W={W}
					H={H}
					cam={{fx: 240 + pan * 60, fy: 1300 - pan * 40, sx: W * 0.5, sy: H * 0.5, scale: (portrait ? 1.9 : 2.0) + pan * 0.15}}
				/>
			</AbsoluteFill>
			<AbsoluteFill style={{background: `linear-gradient(180deg, rgba(11,27,46,0.55), rgba(11,27,46,0.1) 40%, rgba(11,27,46,0.6))`}} />

			<FallingDrops />

			{/* Phase A : chiffre clé */}
			<AbsoluteFill
				style={{
					justifyContent: 'center',
					alignItems: 'center',
					opacity: 1 - exitA,
					transform: `translateX(${-exitA * 80}px)`,
				}}
			>
				<div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: portrait ? -60 : -20}}>
					<Body start={0} size={portrait ? 40 : 38} weight={700} color={COLORS.cyanIce} align="center" style={{letterSpacing: '0.2em', textTransform: 'uppercase', maxWidth: portrait ? 900 : 1400}}>
						{portrait ? (
							<>
								En course, un coureur
								<br />
								perd jusqu'à
							</>
						) : (
							"En course, un coureur perd jusqu'à"
						)}
					</Body>
					<div
						style={{
							fontFamily: TITLE,
							fontSize: bigSize,
							lineHeight: 0.9,
							color: COLORS.white,
							marginTop: 10,
							transform: `scale(${tween(f, [0, 30], [0.86, 1], easeOut)})`,
							opacity: tween(f, [0, 10], [0, 1], easeOut),
							fontVariantNumeric: 'tabular-nums',
						}}
					>
						{litresText}
						<span style={{color: COLORS.cyanBright, marginLeft: '0.12em', textShadow: `0 0 30px ${COLORS.cyan}`}}>L</span>
					</div>
					<KineticTitle lines={portrait ? [['DE SUEUR'], ['PAR HEURE']] : [['DE SUEUR PAR HEURE']]} start={16} size={portrait ? 120 : 110} align="center" />
				</div>
			</AbsoluteFill>

			{/* Phase B : la conséquence */}
			{f >= PART_B - 4 ? (
				<AbsoluteFill style={{justifyContent: 'center', alignItems: portrait ? 'center' : 'flex-start', paddingLeft: portrait ? 0 : W * 0.12}}>
					<KineticTitle
						lines={
							portrait
								? [['BOIRE'], [{text: 'TROP TARD,', color: COLORS.orange}], ["C'EST DÉJÀ"], ['PERDRE EN'], ['PERFORMANCE.']]
								: [['BOIRE', {text: 'TROP TARD,', color: COLORS.orange}], ["C'EST DÉJÀ PERDRE"], ['EN PERFORMANCE.']]
						}
						start={PART_B}
						stagger={4}
						size={portrait ? 170 : 175}
						align={portrait ? 'center' : 'left'}
					/>
				</AbsoluteFill>
			) : null}
		</AbsoluteFill>
	);
};

/** Gouttes qui tombent (accélération) et laissent une onde en touchant le sol. */
const FallingDrops: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, portrait} = useLayout();
	const floor = H * (portrait ? 0.8 : 0.86);
	const drops = new Array(14).fill(0).map((_, i) => {
		const x = W * (0.08 + 0.84 * random(`dx${i}`));
		const delay = -8 + i * 9 + random(`dd${i}`) * 6;
		const size = 34 + random(`ds${i}`) * 46;
		return {x, delay, size, i};
	});
	return (
		<AbsoluteFill>
			<svg width={W} height={H}>
				{drops.map(({x, delay, size, i}) => {
					const t = f - delay;
					if (t < 0) return null;
					const fall = tween(t, [0, 34], [-120, floor], easeIn);
					const landed = t >= 34;
					const ripple = tween(t, [34, 60], [0, 1], easeOut);
					const avoidCenter = Math.abs(x - W / 2) < W * 0.2 ? 0.35 : 0.8;
					return (
						<g key={i}>
							{!landed ? (
								<g transform={`translate(${x} ${fall})`}>
									<Drop size={size} id={`drop${i}`} opacity={avoidCenter} />
								</g>
							) : (
								<ellipse cx={x} cy={floor + size * 0.45} rx={size * 2.2 * ripple} ry={size * 0.45 * ripple} fill="none" stroke={COLORS.cyanBright} strokeWidth={2.5} opacity={(1 - ripple) * avoidCenter} />
							)}
						</g>
					);
				})}
			</svg>
		</AbsoluteFill>
	);
};
