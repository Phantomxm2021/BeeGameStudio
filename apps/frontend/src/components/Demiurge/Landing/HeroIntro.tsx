import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { TextScramble } from '../../beui/registry/components/motion/text-scramble';

interface HeroIntroProps {
    title: string;
    connector: string;
    subtitle: string;
    rotatingWords: string[];
    isTransitioning: boolean;
}

export function HeroIntro({ title, connector, subtitle, rotatingWords, isTransitioning }: HeroIntroProps) {
    const prefersReducedMotion = useReducedMotion();
    const wordsKey = rotatingWords.join('\u0000');
    const words = useMemo(() => rotatingWords.filter(Boolean), [wordsKey]);
    const [wordIndex, setWordIndex] = useState(0);
    const activeWord = words[wordIndex % Math.max(words.length, 1)] ?? '';
    const usesHanCharacters = /[\u3400-\u9fff]/.test(activeWord);

    useEffect(() => {
        setWordIndex(0);
        if (prefersReducedMotion || words.length < 2) return undefined;
        const timer = window.setInterval(() => {
            setWordIndex(index => (index + 1) % words.length);
        }, 2200);
        return () => window.clearInterval(timer);
    }, [prefersReducedMotion, wordsKey, words.length]);

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
            <div className="@container flex w-full justify-center">
                <h1 className="shrink-0 whitespace-nowrap font-display font-semibold tracking-[-0.04em] text-white [font-size:clamp(1.25rem,7.8cqw,3rem)] [line-height:1.12] [text-shadow:0_3px_30px_rgba(0,0,0,0.34)]">
                    {title}{connector}{' '}
                    <span className="relative inline-grid text-left">
                        {words.map(word => (
                            <span key={word} aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">{word}</span>
                        ))}
                        <TextScramble
                            text={activeWord}
                            duration={560}
                            glyphs={usesHanCharacters ? '创意灵感游戏世界光影梦想' : undefined}
                            className="col-start-1 row-start-1 text-white"
                        />
                    </span>
                </h1>
            </div>
            <p className="type-body-lg mt-3 max-w-[34ch] text-pretty text-white/90 [text-shadow:0_2px_18px_rgba(0,0,0,0.38)] sm:mt-4">
                {subtitle}
            </p>
        </motion.section>
    );
}
