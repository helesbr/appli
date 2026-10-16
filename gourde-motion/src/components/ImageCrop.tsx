import React from 'react';
import {AbsoluteFill, Img} from 'remotion';
import {COLORS} from '../lib/theme';

export type Rect = {x: number; y: number; w: number; h: number};
/** Convertit des coordonnées de l'image source en pixels locaux du recadrage. */
export type MapFn = (x: number, y: number) => [number, number];

type Props = {
	src: string;
	imgW: number;
	imgH: number;
	crop: Rect;
	/** Largeur affichée en pixels. */
	width: number;
	/** Étalonnage vers le bleu nuit (0 = aucun). */
	grade?: number;
	radius?: number;
	/** Si l'image est un détourage, position de son coin haut-gauche dans l'image d'origine. */
	origin?: {x: number; y: number};
	style?: React.CSSProperties;
	imgStyle?: React.CSSProperties;
	children?: (map: MapFn, scale: number) => React.ReactNode;
};

/** Affiche une région d'une image fournie (recadrage + overlays alignés). */
export const ImageCrop: React.FC<Props> = ({
	src,
	imgW,
	imgH,
	crop,
	width,
	grade = 0,
	radius = 0,
	origin = {x: 0, y: 0},
	style,
	imgStyle,
	children,
}) => {
	const s = width / crop.w;
	const map: MapFn = (x, y) => [(x - origin.x - crop.x) * s, (y - origin.y - crop.y) * s];
	return (
		<div
			style={{
				position: 'relative',
				width,
				height: crop.h * s,
				overflow: 'hidden',
				borderRadius: radius * s,
				isolation: 'isolate',
				...style,
			}}
		>
			<Img
				src={src}
				style={{
					position: 'absolute',
					left: -crop.x * s,
					top: -crop.y * s,
					width: imgW * s,
					height: imgH * s,
					maxWidth: 'none',
					...imgStyle,
				}}
			/>
			{grade > 0 ? (
				<AbsoluteFill style={{background: COLORS.navy, mixBlendMode: 'color', opacity: grade}} />
			) : null}
			{children ? children(map, s) : null}
		</div>
	);
};

export type Camera = {
	/** Point de l'image source à placer… */
	fx: number;
	fy: number;
	/** …à cette position à l'écran. */
	sx: number;
	sy: number;
	/** Pixels écran par pixel source. */
	scale: number;
};

/** Calcule le recadrage (borné à l'image) d'une caméra et la projection source → écran. */
export const cameraCrop = (cam: Camera, W: number, H: number, imgW: number, imgH: number) => {
	const scale = Math.max(cam.scale, W / imgW, H / imgH);
	const w = W / scale;
	const h = H / scale;
	const x = Math.min(Math.max(cam.fx - cam.sx / scale, 0), imgW - w);
	const y = Math.min(Math.max(cam.fy - cam.sy / scale, 0), imgH - h);
	const toScreen: MapFn = (sx, sy) => [(sx - x) * scale, (sy - y) * scale];
	return {crop: {x, y, w, h}, scale, toScreen};
};

/** Cadre plein écran sur une image, piloté par une « caméra » (zoom / pano). */
export const ImageCamera: React.FC<
	Omit<Props, 'crop' | 'width'> & {cam: Camera; W: number; H: number}
> = ({cam, W, H, imgW, imgH, ...rest}) => {
	const {crop} = cameraCrop(cam, W, H, imgW, imgH);
	return (
		<AbsoluteFill>
			<ImageCrop {...rest} imgW={imgW} imgH={imgH} crop={crop} width={W} />
		</AbsoluteFill>
	);
};

/** Bords fondus (masque) pour intégrer un recadrage dans le fond. */
export const feather = (inner = 55, outer = 72): React.CSSProperties => ({
	WebkitMaskImage: `radial-gradient(ellipse ${outer}% ${outer}% at 50% 50%, #000 ${inner}%, transparent 100%)`,
	maskImage: `radial-gradient(ellipse ${outer}% ${outer}% at 50% 50%, #000 ${inner}%, transparent 100%)`,
});
