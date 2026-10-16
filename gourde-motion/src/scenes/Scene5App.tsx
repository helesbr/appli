import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Background} from '../components/Background';
import {Bottle} from '../components/Bottle';
import {PhoneGauge} from '../components/Gauge';
import {GlowFilter} from '../components/Glow';
import {ImageCrop} from '../components/ImageCrop';
import {Body, Kicker, KineticTitle} from '../components/Text';
import {PRODUIT} from '../lib/assets';
import {BODY, COLORS} from '../lib/theme';
import {easeInOut, easeOut, pop, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

/** 21–26 s · L'appli : le smartphone glisse, la jauge monte à 78 %, liaison Bluetooth. */
export const Scene5App: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, fps, portrait} = useLayout();
	const pc = PRODUIT.phoneCut;
	const bc = PRODUIT.bottleCut;

	// Gourde (statique, légère dérive)
	const bottleH = portrait ? H * 0.5 : H * 0.9;
	const bottleW = (bottleH * bc.w) / bc.h;
	const bx = portrait ? W * 0.73 : W * 0.78;
	const by = portrait ? H * 0.34 : H * 0.5;
	const drift = tween(f, [-12, 150], [0, -16], easeInOut);
	const bs = bottleH / bc.h;
	const btn: [number, number] = [bx - bottleW / 2 + (PRODUIT.button.x - bc.x) * bs, by - bottleH / 2 + (PRODUIT.button.y - bc.y) * bs + drift];

	// Smartphone qui glisse dans le cadre
	const slide = pop(f, fps, -4, 17, 0.9);
	const phoneH = portrait ? H * 0.42 : H * 0.8;
	const phoneW = (phoneH * pc.w) / pc.h;
	const phX = portrait ? W * 0.3 : W * 0.5;
	const phY = portrait ? H * 0.35 : H * 0.5;
	const offX = portrait ? 0 : (1 - slide) * -W * 0.45;
	const offY = portrait ? (1 - slide) * H * 0.6 : 0;
	const phoneRot = (1 - slide) * (portrait ? 8 : -10);
	const phoneLeft = phX - phoneW / 2 + offX;
	const phoneTop = phY - phoneH / 2 + offY;

	// Jauge 0 → 78 %
	const value = tween(f, [22, 82], [0, 78], easeOut);

	// Liaison Bluetooth : courbe de la gourde vers le téléphone
	const link = tween(f, [16, 40], [0, 1], easeInOut);
	const end: [number, number] = [phoneLeft + phoneW * 0.9, phoneTop + phoneH * 0.15];
	const ctrl: [number, number] = [(btn[0] + end[0]) / 2, Math.min(btn[1], end[1]) - (portrait ? 160 : 200)];
	const bez = (t: number): [number, number] => [
		(1 - t) * (1 - t) * btn[0] + 2 * (1 - t) * t * ctrl[0] + t * t * end[0],
		(1 - t) * (1 - t) * btn[1] + 2 * (1 - t) * t * ctrl[1] + t * t * end[1],
	];
	const d = `M ${btn[0]} ${btn[1]} Q ${ctrl[0]} ${ctrl[1]} ${end[0]} ${end[1]}`;
	const apex = bez(0.5);

	const textLeft = portrait ? 80 : 110;

	return (
		<AbsoluteFill>
			<Background glowX={portrait ? 50 : 62} glowY={portrait ? 34 : 50} />

			<div style={{position: 'absolute', left: bx - bottleW / 2, top: by - bottleH / 2 + drift}}>
				<Bottle height={bottleH} led={0.55 + 0.25 * Math.sin(f / 6)} />
			</div>

			<div
				style={{
					position: 'absolute',
					left: phoneLeft,
					top: phoneTop,
					transform: `rotate(${phoneRot}deg)`,
					filter: 'drop-shadow(0 30px 50px rgba(0,0,0,0.55))',
				}}
			>
				<ImageCrop src={pc.src} imgW={pc.w} imgH={pc.h} crop={{x: 0, y: 0, w: pc.w, h: pc.h}} origin={pc} width={phoneW} style={{overflow: 'visible'}}>
					{(map, s) => <PhoneGauge map={map} s={s} value={value} />}
				</ImageCrop>
			</div>

			<AbsoluteFill>
				<svg width={W} height={H}>
					<GlowFilter id="btglow" blur={6} />
					<path d={d} pathLength={1} fill="none" stroke={COLORS.cyanBright} strokeWidth={3} strokeDasharray="1 1" strokeDashoffset={1 - link} opacity={0.9} filter="url(#btglow)" />
					<path d={d} pathLength={100} fill="none" stroke="#E6FBFF" strokeWidth={2} strokeDasharray="1.2 2.4" strokeDashoffset={f * 0.6} opacity={link >= 1 ? 0.8 : 0} />
					{link >= 1
						? [0, 1, 2].map((k) => {
								const t = ((f - 40) / 34 + k / 3) % 1;
								const [x, y] = bez(easeInOut(t));
								return <circle key={k} cx={x} cy={y} r={7} fill="#F0FDFF" filter="url(#btglow)" opacity={Math.sin(t * Math.PI)} />;
							})
						: null}
					<circle cx={btn[0]} cy={btn[1]} r={8} fill={COLORS.cyanBright} opacity={link > 0 ? 1 : 0} filter="url(#btglow)" />
					<circle cx={end[0]} cy={end[1]} r={8} fill={COLORS.cyanBright} opacity={link >= 1 ? 1 : 0} filter="url(#btglow)" />
				</svg>
				<div
					style={{
						position: 'absolute',
						left: apex[0],
						top: apex[1] - 26,
						transform: `translate(-50%, -100%) scale(${pop(f, fps, 34, 15, 0.7)})`,
						padding: '8px 20px',
						borderRadius: 999,
						border: `2px solid ${COLORS.cyanBright}`,
						background: 'rgba(11,27,46,0.88)',
						fontFamily: BODY,
						fontWeight: 700,
						fontSize: 24,
						letterSpacing: '0.24em',
						color: COLORS.cyanIce,
						whiteSpace: 'nowrap',
					}}
				>
					BLUETOOTH
				</div>
			</AbsoluteFill>

			{/* Texte */}
			<div
				style={{
					position: 'absolute',
					left: textLeft,
					right: portrait ? 80 : undefined,
					top: portrait ? H * 0.6 : H * 0.27,
					width: portrait ? undefined : W * 0.3,
				}}
			>
				<Kicker text="04 · Partager" start={6} />
				<KineticTitle lines={portrait ? [['SUIVI EN TEMPS RÉEL'], ['POUR LE STAFF']] : [['SUIVI EN'], ['TEMPS RÉEL'], ['POUR LE STAFF']]} start={12} size={portrait ? 128 : 118} style={{marginTop: 22}} />
				<Body start={28} size={portrait ? 40 : 34} style={{marginTop: 24, maxWidth: portrait ? 900 : 520}}>
					Les données partent vers l'application mobile du staff médical et des entraîneurs.
				</Body>
			</div>
		</AbsoluteFill>
	);
};
