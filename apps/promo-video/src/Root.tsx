import { Composition } from 'remotion';
import { IdeaToGame } from './IdeaToGame';
import { videoScenario } from './video-scenario';
import './product-ui/frontend.css';

export function RemotionRoot() {
  return <Composition id="IdeaToGame" component={IdeaToGame} durationInFrames={videoScenario.durationInFrames} fps={videoScenario.fps} width={videoScenario.width} height={videoScenario.height} />;
}
