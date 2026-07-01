import { motion } from 'framer-motion';

interface HeroIntroProps {
    title: string;
    subtitle: string;
    isTransitioning: boolean;
}

export function HeroIntro({ title, subtitle, isTransitioning }: HeroIntroProps) {
    return (
        <motion.section
            initial={{ y: 18, opacity: 0 }}
            animate={
                isTransitioning
                    ? { y: -8, opacity: 0, filter: 'blur(8px)' }
                    : { y: 0, opacity: 1, filter: 'blur(0px)' }
            }
            transition={{ duration: isTransitioning ? 0.45 : 0.5, ease: 'easeOut' }}
            className="relative z-10 mb-8 flex w-full max-w-[860px] flex-col items-center px-6 text-center"
        >
            <h1 className="type-large-title max-w-full text-zinc-950 dark:text-white">
                {title}
            </h1>
            <p className="type-body mt-4 text-zinc-500 dark:text-zinc-400">
                {subtitle}
            </p>
        </motion.section>
    );
}
