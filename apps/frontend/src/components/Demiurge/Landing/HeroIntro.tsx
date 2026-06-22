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
            <h1 className="max-w-full text-5xl font-semibold leading-[1.05] tracking-normal text-zinc-950 dark:text-white">
                {title}
            </h1>
            <p className="mt-4 text-base font-medium tracking-normal text-zinc-500 sm:text-lg dark:text-zinc-400">
                {subtitle}
            </p>
        </motion.section>
    );
}
