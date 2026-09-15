import { motion, useReducedMotion } from 'motion/react';

interface HeroIntroProps {
    title: string;
    subtitle: string;
    isTransitioning: boolean;
}

export function HeroIntro({ title, subtitle, isTransitioning }: HeroIntroProps) {
    const prefersReducedMotion = useReducedMotion();

    return (
        <motion.section
            initial={prefersReducedMotion ? { opacity: 0 } : { y: 10, opacity: 0 }}
            animate={
                isTransitioning
                    ? prefersReducedMotion ? { opacity: 0 } : { y: -4, opacity: 0 }
                    : prefersReducedMotion ? { opacity: 1 } : { y: 0, opacity: 1 }
            }
            transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: 'easeOut' }}
            className="relative z-10 flex w-full max-w-[860px] flex-col items-center px-6 text-center"
        >
            <h1 className="max-w-full text-xl font-semibold leading-7 tracking-tight text-foreground sm:text-2xl sm:leading-[34px]">
                {title}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
                {subtitle}
            </p>
        </motion.section>
    );
}
