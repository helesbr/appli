import React from 'react';
import {AbsoluteFill, Audio, getStaticFiles, interpolate, Sequence, staticFile} from 'remotion';
import {MUSIC_VOLUME_WITH_SFX, SFX} from './lib/sound';
import {SceneTransition, TransitionKind} from './components/Transitions';
import {SceneOffset} from './lib/layout';
import {easeInOut} from './lib/anim';
import {COLORS} from './lib/theme';
import {FPS, SCENES, SceneId, TOTAL_DURATION, TRANSITION} from './lib/timing';
import {Scene1Hook} from './scenes/Scene1Hook';
import {Scene2Problem} from './scenes/Scene2Problem';
import {Scene3Patch} from './scenes/Scene3Patch';
import {Scene4Bottle} from './scenes/Scene4Bottle';
import {Scene5App} from './scenes/Scene5App';
import {Scene6Outro} from './scenes/Scene6Outro';

export const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
	hook: Scene1Hook,
	problem: Scene2Problem,
	patch: Scene3Patch,
	bottle: Scene4Bottle,
	app: Scene5App,
	outro: Scene6Outro,
};

/** Transition d'entrée de chaque scène. */
const ENTER: Record<SceneId, TransitionKind> = {
	hook: 'none',
	problem: 'wipe-flash',
	patch: 'wipe',
	bottle: 'flash',
	app: 'wipe-reverse',
	outro: 'wipe-flash',
};

const ORDER: SceneId[] = ['hook', 'problem', 'patch', 'bottle', 'app', 'outro'];

const MUSIC = 'music.mp3';
const hasFile = (name: string) => getStaticFiles().some((f) => f.name === name);
const hasMusic = () => hasFile(MUSIC);
const musicVol = () => (SFX.some((c) => hasFile(`sfx/${c.file}`)) ? MUSIC_VOLUME_WITH_SFX : 0.8);

/** Bruitages présents dans public/sfx/ (les repères sans fichier sont ignorés). */
const SoundDesign: React.FC = () => (
	<>
		{SFX.filter((c) => hasFile(`sfx/${c.file}`)).map((c, i) => {
			const rate = c.rate ?? 1;
			const dur = Math.round((c.duration ?? 4) * FPS);
			const fade = Math.max(1, Math.round((c.fadeOut ?? 0.25) * FPS));
			return (
				<Sequence key={i} from={c.at} durationInFrames={dur} name={`sfx ${c.file}`} layout="none">
					<Audio
						src={staticFile(`sfx/${c.file}`)}
						playbackRate={rate}
						trimBefore={c.trim ? Math.round(c.trim * FPS) : undefined}
						volume={(f) => c.volume * interpolate(f, [dur - fade, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
					/>
				</Sequence>
			);
		})}
	</>
);

export const Main: React.FC = () => (
	<AbsoluteFill style={{background: COLORS.night}}>
		{ORDER.map((id, i) => {
			const {from, duration} = SCENES[id];
			const lead = i === 0 ? 0 : TRANSITION;
			const Comp = SCENE_COMPONENTS[id];
			return (
				<Sequence key={id} name={`${i + 1}. ${id}`} from={from - lead} durationInFrames={duration + lead}>
					<SceneOffset.Provider value={lead}>
						<SceneTransition kind={ENTER[id]}>
							<Comp />
						</SceneTransition>
					</SceneOffset.Provider>
				</Sequence>
			);
		})}
		<SoundDesign />
		{hasMusic() ? (
			<Audio
				src={staticFile(MUSIC)}
				volume={(f) =>
					interpolate(f, [0, 30, TOTAL_DURATION - 45, TOTAL_DURATION], [0, musicVol(), musicVol(), 0], {
						easing: easeInOut,
						extrapolateLeft: 'clamp',
						extrapolateRight: 'clamp',
					})
				}
			/>
		) : null}
	</AbsoluteFill>
);

/** Une scène seule (pour la prévisualiser ou la re-rendre isolément). */
export const SingleScene: React.FC<{scene: SceneId}> = ({scene}) => {
	const Comp = SCENE_COMPONENTS[scene];
	return (
		<AbsoluteFill style={{background: COLORS.night}}>
			<SceneOffset.Provider value={0}>
				<Comp />
			</SceneOffset.Provider>
		</AbsoluteFill>
	);
};
