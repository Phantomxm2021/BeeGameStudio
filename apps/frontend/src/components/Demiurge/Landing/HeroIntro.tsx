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
            initial={prefersReducedMotion ? { opacity: 0 } : { y: 18, opacity: 0, filter: 'blur(8px)' }}
            animate={
                isTransitioning
                    ? prefersReducedMotion ? { opacity: 0 } : { y: -8, opacity: 0, filter: 'blur(4px)' }
                    : prefersReducedMotion ? { opacity: 1 } : { y: 0, opacity: 1, filter: 'blur(0px)' }
            }
            transition={{ duration: prefersReducedMotion ? 0 : 0.48, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex w-full flex-col items-center text-center text-white"
        >
            <h1 className="max-w-4xl text-balance text-[clamp(2.75rem,7vw,5rem)] font-semibold leading-[1.02] tracking-[-0.05em] text-white [text-shadow:0_3px_30px_rgba(0,0,0,0.28)]">
                {title}
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-white/82 [text-shadow:0_2px_18px_rgba(0,0,0,0.34)] sm:mt-5 sm:text-base sm:leading-7">
                {subtitle}
            </p>
        </motion.section>
    );
}
