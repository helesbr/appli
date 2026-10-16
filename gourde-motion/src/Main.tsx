import React from 'react';
import {AbsoluteFill, Audio, getStaticFiles, interpolate, Sequence, staticFile} from 'remotion';
import {SceneTransition, TransitionKind} from './components/Transitions';
import {SceneOffset} from './lib/layout';
import {easeInOut} from './lib/anim';
import {COLORS} from './lib/theme';
import {SCENES, SceneId, TOTAL_DURATION, TRANSITION} from './lib/timing';
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
const hasMusic = () => getStaticFiles().some((f) => f.name === MUSIC);

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
		{hasMusic() ? (
			<Audio
				src={staticFile(MUSIC)}
				volume={(f) =>
					interpolate(f, [0, 30, TOTAL_DURATION - 45, TOTAL_DURATION], [0, 0.8, 0.8, 0], {
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
