import { motion } from 'framer-motion';

interface DemiurgeLogoProps {
    className?: string;
}

export function DemiurgeLogo({ className = "w-16 h-16" }: DemiurgeLogoProps) {
    return (
        <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="glowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#818cf8" /> {/* Indigo-400 */}
                    <stop offset="50%" stopColor="#c084fc" /> {/* Purple-400 */}
                    <stop offset="100%" stopColor="#ec4899" /> {/* Pink-500 */}
                </linearGradient>
                <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>

            {/* Background floating particles / mini-nodes */}
            {[...Array(6)].map((_, i) => (
                <motion.circle
                    key={`particle-${i}`}
                    r="1.5"
                    fill="url(#glowGradient)"
                    initial={{
                        cx: 50,
                        cy: 50,
                        opacity: 0,
                    }}
                    animate={{
                        cx: 50 + Math.cos((i * Math.PI * 2) / 6) * 45,
                        cy: 50 + Math.sin((i * Math.PI * 2) / 6) * 45,
                        opacity: [0, 0.8, 0],
                        scale: [0, 1.5, 0],
                    }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        delay: i * 0.5,
                        ease: "easeOut",
                    }}
                />
            ))}

            {/* Orbiting Ring 1 - Outer Dashed */}
            <motion.circle
                cx="50" cy="50" r="38"
                fill="none"
                stroke="url(#glowGradient)"
                strokeWidth="1.5"
                strokeDasharray="15 15"
                animate={{ rotate: 360 }}
                transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: "center" }}
            />

            {/* Orbiting Ring 2 - Inner Asymmetrical */}
            <motion.circle
                cx="50" cy="50" r="28"
                fill="none"
                stroke="url(#glowGradient)"
                strokeWidth="2"
                strokeDasharray="40 10 10 10"
                animate={{ rotate: -360 }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: "center" }}
            />

            {/* Core Energy Hexagon Path drawing effect */}
            <motion.path
                d="M50 18 L77.7 34 L77.7 66 L50 82 L22.3 66 L22.3 34 Z"
                fill="none"
                stroke="url(#glowGradient)"
                strokeWidth="1.5"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.3 }}
                transition={{
                    duration: 4,
                    repeat: Infinity,
                    repeatType: "reverse",
                    ease: "easeInOut"
                }}
            />

            {/* Core 'Spark' / Artisan Diamond */}
            <motion.path
                d="M50 30 L60 50 L50 70 L40 50 Z"
                fill="url(#glowGradient)"
                filter="url(#neonGlow)"
                animate={{
                    scale: [1, 1.15, 1],
                    opacity: [0.7, 1, 0.7]
                }}
                transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "easeInOut"
                }}
                style={{ transformOrigin: "center" }}
            />

            {/* Inner Core Pulse */}
            <motion.circle
                cx="50" cy="50" r="4"
                fill="#ffffff"
                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                style={{ transformOrigin: "center" }}
            />
        </svg>
    );
}
