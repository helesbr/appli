import React from 'react';
import {Img} from 'remotion';
import {MapFn} from './ImageCrop';
import {PRODUIT} from '../lib/assets';
import {COLORS} from '../lib/theme';

/** La gourde, détourée depuis produit.png, avec la LED pilotable et un contre-jour cyan. */
export const Bottle: React.FC<{
	height: number;
	led: number; // intensité de la LED ajoutée (0–1.5)
	backlight?: number;
	children?: (map: MapFn, s: number) => React.ReactNode;
}> = ({height, led, backlight = 1, children}) => {
	const c = PRODUIT.bottleCut;
	const s = height / c.h;
	const width = c.w * s;
	const map: MapFn = (x, y) => [(x - c.x) * s, (y - c.y) * s];
	const [lx, ly1] = map(PRODUIT.led.x, PRODUIT.led.y1);
	const [, ly2] = map(PRODUIT.led.x, PRODUIT.led.y2);
	const w = 9 * s;
	return (
		<div style={{position: 'relative', width, height}}>
			{/* Contre-jour */}
			<div
				style={{
					position: 'absolute',
					left: -width * 0.6,
					top: height * 0.05,
					width: width * 2.2,
					height: height * 0.9,
					background: `radial-gradient(ellipse 50% 50% at 50% 50%, rgba(8,145,178,${0.32 * backlight}) 0%, rgba(8,145,178,0) 70%)`,
				}}
			/>
			{/* Ombre au sol */}
			<div
				style={{
					position: 'absolute',
					left: width * 0.05,
					top: height * 0.93,
					width: width * 0.85,
					height: height * 0.06,
					borderRadius: '50%',
					background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0,0,0,0.6), rgba(0,0,0,0))',
				}}
			/>
			<Img src={c.src} style={{position: 'absolute', left: 0, top: 0, width, height, filter: 'brightness(1.12) contrast(1.04)'}} />
			{led > 0 ? (
				<>
					<div
						style={{
							position: 'absolute',
							left: lx - w * 4,
							top: ly1 - w * 3,
							width: w * 8,
							height: ly2 - ly1 + w * 6,
							borderRadius: w * 4,
							background: `radial-gradient(ellipse 50% 50% at 50% 50%, rgba(34,211,238,${0.55 * led}) 0%, rgba(8,145,178,0) 100%)`,
						}}
					/>
					<div
						style={{
							position: 'absolute',
							left: lx - w / 2,
							top: ly1,
							width: w,
							height: ly2 - ly1,
							borderRadius: w,
							background: '#E6FBFF',
							opacity: Math.min(1, led),
							boxShadow: `0 0 ${8 * s}px ${COLORS.cyanBright}, 0 0 ${22 * s}px ${COLORS.cyanBright}, 0 0 ${50 * s}px ${COLORS.cyan}`,
						}}
					/>
				</>
			) : null}
			{children ? children(map, s) : null}
		</div>
	);
};
