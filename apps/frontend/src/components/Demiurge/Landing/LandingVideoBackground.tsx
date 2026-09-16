import { useReducedMotion } from 'motion/react';
import backgroundVideo from '../../../assets/background.mp4';

export function LandingVideoBackground() {
    const reducedMotion = useReducedMotion() ?? false;

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#d8884d] dark:bg-[#090705]" aria-hidden="true">
            <video
                data-testid="landing-background-video"
                className="h-full w-full scale-[1.02] object-cover saturate-[1.12] contrast-[1.03]"
                src={backgroundVideo}
                autoPlay={!reducedMotion}
                muted
                loop
                playsInline
                preload="auto"
            />
            <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,194,74,0.34),rgba(255,118,71,0.22)_58%,rgba(220,76,53,0.34))] mix-blend-color" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,12,6,0.18),rgba(26,13,5,0.08)_48%,rgba(20,10,4,0.3))] dark:bg-[linear-gradient(180deg,rgba(0,0,0,0.42),rgba(0,0,0,0.3)_48%,rgba(0,0,0,0.66))]" />
        </div>
    );
}
