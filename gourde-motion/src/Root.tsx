import React from 'react';
import {Composition, Folder} from 'remotion';
import {Main, SingleScene} from './Main';
import {FPS, SCENES, SceneId, TOTAL_DURATION} from './lib/timing';

const FORMATS = {
	'16x9': {width: 1920, height: 1080},
	'9x16': {width: 1080, height: 1920},
};

const SCENE_NAMES: Record<SceneId, string> = {
	hook: 'S1-Accroche',
	problem: 'S2-Probleme',
	patch: 'S3-Patch',
	bottle: 'S4-Gourde',
	app: 'S5-Appli',
	outro: 'S6-Cloture',
};

export const RemotionRoot: React.FC = () => (
	<>
		<Composition id="GourdeConnectee" component={Main} durationInFrames={TOTAL_DURATION} fps={FPS} {...FORMATS['16x9']} />
		<Composition id="GourdeConnecteeVertical" component={Main} durationInFrames={TOTAL_DURATION} fps={FPS} {...FORMATS['9x16']} />
		{(['16x9', '9x16'] as const).map((fmt) => (
			<Folder key={fmt} name={`Scenes-${fmt}`}>
				{(Object.keys(SCENES) as SceneId[]).map((id) => (
					<Composition
						key={id}
						id={`${SCENE_NAMES[id]}-${fmt}`}
						component={SingleScene}
						defaultProps={{scene: id}}
						durationInFrames={SCENES[id].duration}
						fps={FPS}
						{...FORMATS[fmt]}
					/>
				))}
			</Folder>
		))}
	</>
);
