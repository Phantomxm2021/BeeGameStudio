import { motion } from 'framer-motion';
import backgroundVideo from '../../../assets/background.mp4';

interface FaultyTerminalBackgroundProps {
    isTransitioning: boolean;
}

export function FaultyTerminalBackground({ isTransitioning }: FaultyTerminalBackgroundProps) {
    return (
        <motion.div
            data-testid="faulty-terminal-background"
            data-background="video"
            animate={{ opacity: isTransitioning ? 0 : 1 }}
            transition={{ duration: 0.5 }}
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none bg-zinc-950"
            aria-hidden="true"
        >
            <video
                data-testid="landing-background-video"
                className="h-full w-full object-cover"
                src={backgroundVideo}
                autoPlay
                muted 
                playsInline
                preload="metadata"
            />
            <div className="absolute inset-0 bg-zinc-950/50" />
        </motion.div>
    );
}
