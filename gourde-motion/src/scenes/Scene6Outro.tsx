import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Vignette} from '../components/Background';
import {GlowFilter, LedStroke} from '../components/Glow';
import {ImageCamera} from '../components/ImageCrop';
import {Body, KineticTitle} from '../components/Text';
import {AFFICHE, PRODUIT} from '../lib/assets';
import {COLORS} from '../lib/theme';
import {easeInOut, easeOut, tween} from '../lib/anim';
import {useLayout, useSceneFrame} from '../lib/layout';

const SIGN = 38; // apparition de la signature

/** 26–30 s · Clôture : plan produit complet, puis signature et crédits. */
export const Scene6Outro: React.FC = () => {
	const f = useSceneFrame();
	const {W, H, portrait} = useLayout();
	const img = portrait ? AFFICHE : PRODUIT;

	const zoom = tween(f, [-12, 120], [1.1, 1.0], easeOut);
	const dim = tween(f, [SIGN - 8, SIGN + 14], [0, 1], easeInOut);
	const base = portrait ? Math.max(W / AFFICHE.w, H / AFFICHE.h) : Math.max(W / PRODUIT.w, H / PRODUIT.h);
	const cam = {fx: img.w / 2, fy: img.h / 2, sx: W / 2, sy: H / 2, scale: base * zoom};

	const lineP = tween(f, [SIGN + 14, SIGN + 40], [0, 1], easeInOut);
	const lineY = portrait ? H * 0.585 : H * 0.6;
	const half = portrait ? W * 0.3 : W * 0.16;

	return (
		<AbsoluteFill style={{background: COLORS.night}}>
			<AbsoluteFill style={{filter: `blur(${dim * 6}px)`, transform: `scale(${1 + dim * 0.03})`}}>
				<ImageCamera src={img.src} imgW={img.w} imgH={img.h} W={W} H={H} cam={cam} grade={portrait ? 0.1 : 0.35} />
			</AbsoluteFill>
			<AbsoluteFill style={{background: COLORS.night, opacity: dim * (portrait ? 0.86 : 0.78)}} />
			<Vignette strength={0.6} />

			<AbsoluteFill style={{alignItems: 'center'}}>
				<div style={{position: 'absolute', top: portrait ? H * 0.27 : H * 0.27, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
					<KineticTitle
						lines={portrait ? [["PLUS QU'UNE"], ['GOURDE, UN ALLIÉ'], ['POUR LA'], [{text: 'PERFORMANCE.', color: COLORS.cyanBright}]] : [["PLUS QU'UNE GOURDE,"], ['UN ALLIÉ POUR LA', {text: 'PERFORMANCE.', color: COLORS.cyanBright}]]}
						start={SIGN}
						stagger={3}
						size={portrait ? 132 : 130}
						align="center"
					/>
				</div>
			</AbsoluteFill>

			<AbsoluteFill>
				<svg width={W} height={H}>
					<GlowFilter id="outroglow" blur={8} />
					<LedStroke d={`M ${W / 2} ${lineY} L ${W / 2 + half} ${lineY}`} progress={lineP} width={4} filterId="outroglow" />
					<LedStroke d={`M ${W / 2} ${lineY} L ${W / 2 - half} ${lineY}`} progress={lineP} width={4} filterId="outroglow" />
				</svg>
			</AbsoluteFill>

			<div style={{position: 'absolute', top: lineY + 36, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16}}>
				<Body start={SIGN + 18} size={portrait ? 36 : 34} weight={700} color={COLORS.cyanIce} align="center" style={{letterSpacing: '0.06em'}}>
					{portrait ? (
						<>
							Objectif Tour de France 2028
							<br />
							Projet EPF FGE3
						</>
					) : (
						'Objectif Tour de France 2028 · Projet EPF FGE3'
					)}
				</Body>
				<Body start={SIGN + 26} size={portrait ? 32 : 28} color={COLORS.mist} align="center" style={{letterSpacing: '0.04em', marginTop: 6}}>
					M. Ammi · H. Essabar · A. Baily · E. Radi
				</Body>
			</div>
			{/* Fondu final très léger vers le bleu nuit */}
			<AbsoluteFill style={{background: COLORS.night, opacity: tween(f, [114, 120], [0, 0.3], easeOut)}} />
		</AbsoluteFill>
	);
};
