import React, { useRef, useState, useMemo } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { CheckCircle, FileText, MessageSquare, ShieldAlert, Wrench } from 'lucide-react';
import { AGENT_UI_MAP, BeeIcon, CONNECTIONS, LAYER_CONFIG } from './AgentsConfig';
import type { AgentLayer } from './AgentsConfig';

interface CanvasViewProps {
    isDark: boolean;
    activeAgentId: string | null;
    agentStatuses: Record<string, string>;
    commFlow: Array<{ from: string, to: string, id: number, isP2P?: boolean }>;
    mode?: 'demiurge' | 'beegame';
    status?: 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
    hasPendingPermission?: boolean;
}

// Card dimensions for edge anchor calculations
const CARD_W = 224;
const CARD_H = 80;

/**
 * Compute a vertical bezier curve between two node anchors.
 * Source exits from bottom-center, target enters at top-center.
 * For same-row (horizontal) connections, use a gentle S-curve.
 */
function computeEdgePath(
    fromX: number, fromY: number,
    toX: number, toY: number
): string {
    const sx = fromX + CARD_W / 2;
    const sy = fromY + CARD_H;
    const ex = toX + CARD_W / 2;
    const ey = toY;

    // Vertical distance between rows
    const dy = Math.abs(ey - sy);
    // For same-row cross-links, enter/exit from sides
    if (dy < 40) {
        const goingRight = ex > sx;
        const startX = goingRight ? fromX + CARD_W : fromX;
        const startY = fromY + CARD_H / 2;
        const endX = goingRight ? toX : toX + CARD_W;
        const endY = toY + CARD_H / 2;
        const cpOffset = Math.abs(endX - startX) * 0.4;
        return `M ${startX} ${startY} C ${startX + (goingRight ? cpOffset : -cpOffset)} ${startY - 30}, ${endX + (goingRight ? -cpOffset : cpOffset)} ${endY - 30}, ${endX} ${endY}`;
    }

    // Standard vertical bezier
    const cpDy = dy * 0.45;
    return `M ${sx} ${sy} C ${sx} ${sy + cpDy}, ${ex} ${ey - cpDy}, ${ex} ${ey}`;
}

const ACTIVE_EDGE_PROPS = {
    strokeWidth: "3",
    initial: { strokeDashoffset: 100, opacity: 0 },
    animate: { strokeDashoffset: 0, opacity: 0.9 },
    transition: {
        strokeDashoffset: { repeat: Infinity, ease: "linear" as const, duration: 1.2 },
        opacity: { duration: 0.5 }
    }
};

export function CanvasView({
    isDark,
    activeAgentId,
    agentStatuses,
    commFlow,
    mode = 'demiurge',
    status = 'idle',
    hasPendingPermission = false,
}: CanvasViewProps) {
    const x = useMotionValue(0);
    const y = useMotionValue(20);
    const scale = useMotionValue(0.7);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Initial centering effect
    React.useEffect(() => {
        if (containerRef.current) {
            const { width, height } = containerRef.current.getBoundingClientRect();
            // Fit 1000px wide content towards the left (to avoid sidebar on right)
            const targetScale = Math.min((width - 400) / 1000, height / 1000, 0.7);
            scale.set(targetScale);
            // x position with a 60px left margin
            x.set(60);
            y.set(40);
        }
    }, [scale, x, y]);

    const handleDrag = (e: React.MouseEvent) => {
        if (isDragging) {
            x.set(x.get() + e.movementX);
            y.set(y.get() + e.movementY);
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        const delta = e.deltaY * -0.001;
        const newScale = Math.min(Math.max(scale.get() + delta, 0.1), 2);
        scale.set(newScale);
    };

    // Pre-compute layer separator Y positions (midpoints between layers)
    const layerSeparators = useMemo(() => {
        const layers = Object.values(LAYER_CONFIG);
        const seps: number[] = [];
        for (let i = 0; i < layers.length - 1; i++) {
            seps.push((layers[i].y + CARD_H + layers[i + 1].y) / 2);
        }
        return seps;
    }, []);

    if (mode === 'beegame') {
        const isRunning = status === 'running' || Boolean(activeAgentId);
        const isWaiting = status === 'waiting_approval' || hasPendingPermission;
        const sessionStatus = isWaiting ? 'Waiting for permission' : isRunning ? 'Streaming response' : status === 'offline' ? 'Server unreachable' : 'Ready for input';
        const nodes = [
            {
                id: 'request',
                label: 'User Request',
                detail: 'Your prompt enters a BeeGame session',
                icon: MessageSquare,
                x: 80,
                y: 260,
                active: isRunning || isWaiting,
            },
            {
                id: 'beegame',
                label: 'BeeGame',
                detail: sessionStatus,
                icon: BeeIcon,
                x: 390,
                y: 210,
                active: isRunning || isWaiting,
                primary: true,
            },
            {
                id: 'tools',
                label: 'Tools',
                detail: 'Bash, Read, Write, Edit and search events',
                icon: Wrench,
                x: 720,
                y: 135,
                active: isRunning,
            },
            {
                id: 'permissions',
                label: 'Permissions',
                detail: isWaiting ? 'Approve or deny in the chat panel' : 'Shown only when BeeGame asks',
                icon: ShieldAlert,
                x: 720,
                y: 320,
                active: isWaiting,
            },
            {
                id: 'files',
                label: 'Files',
                detail: 'Write/Edit outputs appear in Artifacts',
                icon: FileText,
                x: 390,
                y: 470,
                active: isRunning,
            },
        ];

        return (
            <div className="w-full h-full relative overflow-hidden">
                <div
                    className="absolute inset-[-4000px] opacity-[0.03] dark:opacity-[0.06]"
                    style={{
                        backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}
                />
                <div className="absolute left-[120px] top-[150px] w-[980px] h-[620px]">
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                        <path d="M 304 300 C 360 300, 390 280, 390 250" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.12" fill="none" className="text-zinc-500 dark:text-zinc-400" />
                        <path d="M 614 250 C 660 220, 700 190, 720 175" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.12" fill="none" className="text-zinc-500 dark:text-zinc-400" />
                        <path d="M 614 250 C 670 285, 695 340, 720 360" stroke="currentColor" strokeWidth="1.5" strokeOpacity={isWaiting ? "0.5" : "0.12"} fill="none" className={isWaiting ? "text-amber-500" : "text-zinc-500 dark:text-zinc-400"} />
                        <path d="M 502 290 C 500 360, 500 425, 502 470" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.12" fill="none" className="text-zinc-500 dark:text-zinc-400" />
                    </svg>
                    {nodes.map((node) => {
                        const Icon = node.icon;
                        return (
                            <motion.div
                                key={node.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{
                                    opacity: 1,
                                    y: 0,
                                    scale: node.active ? 1.04 : 1,
                                    boxShadow: node.active
                                        ? (isDark ? '0 0 42px rgba(255,255,255,0.06)' : '0 24px 48px -18px rgba(0,0,0,0.24)')
                                        : 'none'
                                }}
                                className={`absolute w-56 p-5 rounded-[2.5rem] border-2 backdrop-blur-2xl transition-all duration-700 ${node.active
                                    ? node.id === 'permissions'
                                        ? 'border-amber-400 bg-white dark:bg-zinc-900'
                                        : 'border-blue-500 dark:border-blue-400 bg-white dark:bg-zinc-900'
                                    : 'border-zinc-200 dark:border-zinc-800 bg-white/45 dark:bg-zinc-950/45'
                                    }`}
                                style={{ left: node.x, top: node.y }}
                            >
                                <div className="flex items-center space-x-4">
                                    <div className={`p-3 rounded-2xl shadow-inner ${node.active
                                        ? node.id === 'permissions'
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-blue-500 text-white dark:bg-blue-400 dark:text-zinc-900'
                                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                                        }`}>
                                        <Icon className="w-6 h-6" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase opacity-40 tracking-widest text-zinc-900 dark:text-zinc-100">
                                            {node.primary ? 'runtime' : node.id}
                                        </div>
                                        <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                                            {node.label}
                                        </div>
                                    </div>
                                </div>
                                <div className={`mt-3 text-[10px] font-bold uppercase tracking-[0.16em] ${node.active
                                    ? node.id === 'permissions'
                                        ? 'text-amber-500'
                                        : 'text-blue-500 dark:text-blue-400'
                                    : 'text-zinc-400 dark:text-zinc-600'
                                    }`}>
                                    {node.detail}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="w-full h-full relative cursor-grab active:cursor-grabbing overflow-hidden"
            onMouseDown={(e) => { if (e.button === 0) setIsDragging(true); }}
            onMouseMove={handleDrag}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
            onWheel={handleWheel}
        >
            <motion.div
                style={{ x, y, scale }}
                className="absolute inset-0"
            >
                {/* Background Grid Pattern */}
                <div
                    className="absolute inset-[-4000px] opacity-[0.03] dark:opacity-[0.06]"
                    style={{
                        backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}
                />

                {/* Entrance Arrow */}
                <div className="absolute flex flex-col items-center pointer-events-none" style={{ left: 500 - 64, top: 60, width: 128 }}>
                    <motion.div
                        animate={activeAgentId ? { y: [0, 8, 0] } : false}
                        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                        className="flex flex-col items-center text-zinc-400 dark:text-zinc-500"
                    >
                        <div className="text-[9px] font-black tracking-[0.25em] uppercase mb-1 drop-shadow-md">User Request</div>
                        <div className="w-0.5 h-10 bg-gradient-to-b from-transparent to-zinc-400 dark:to-zinc-500 rounded-full" />
                        <div className="w-3 h-3 border-b-[3px] border-r-[3px] border-zinc-400 dark:border-zinc-500 transform rotate-45 -mt-1.5" />
                    </motion.div>
                </div>

                {/* SVG Connection Layer */}
                <svg className="absolute inset-0 w-[4000px] h-[4000px] pointer-events-none overflow-visible">
                    {/* Layer separator lines */}
                    {layerSeparators.map((sepY, i) => (
                        <line
                            key={`sep-${i}`}
                            x1="20" y1={sepY}
                            x2="980" y2={sepY}
                            stroke="currentColor"
                            strokeWidth="1"
                            strokeDasharray="6 8"
                            strokeOpacity="0.06"
                            className="text-zinc-500 dark:text-zinc-400"
                        />
                    ))}

                    {/* Static workflow edges (bezier) */}
                    {useMemo(() => CONNECTIONS.map((conn, i) => {
                        const from = AGENT_UI_MAP[conn.from];
                        const to = AGENT_UI_MAP[conn.to];
                        if (!from || !to) return null;
                        const pathD = computeEdgePath(from.x, from.y, to.x, to.y);
                        return (
                            <path
                                key={`edge-${i}`}
                                d={pathD}
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeOpacity="0.08"
                                fill="none"
                                strokeLinecap="round"
                                className="text-zinc-500 dark:text-zinc-400 transition-colors duration-500"
                            />
                        );
                    }), [])}

                    {/* Active Communication Flows */}
                    {commFlow.map((flow, idx) => {
                        const from = AGENT_UI_MAP[flow.from];
                        const to = AGENT_UI_MAP[flow.to];
                        if (!from || !to) return null;
                        const pathD = computeEdgePath(from.x, from.y, to.x, to.y);

                        return (
                            <g key={`flow-${flow.id}-${idx}`}>
                                {/* Glow layer */}
                                <motion.path
                                    d={pathD}
                                    stroke="currentColor"
                                    fill="none"
                                    strokeLinecap="round"
                                    filter="drop-shadow(0 0 6px rgba(59, 130, 246, 0.4))"
                                    strokeDasharray={flow.isP2P ? "8 8" : "none"}
                                    className="text-blue-500 dark:text-blue-400"
                                    {...ACTIVE_EDGE_PROPS}
                                    animate={idx === commFlow.length - 1 ? ACTIVE_EDGE_PROPS.animate : false}
                                />
                            </g>
                        );
                    })}
                </svg>

                {/* Layer Labels */}
                {(Object.entries(LAYER_CONFIG) as [AgentLayer, typeof LAYER_CONFIG[AgentLayer]][]).map(([, config]) => (
                    <div
                        key={config.labelEn}
                        className="absolute pointer-events-none select-none"
                        style={{ left: -4, top: config.y + CARD_H / 2 - 10 }}
                    >
                        <div
                            className="text-[8px] font-black tracking-[0.3em] uppercase text-zinc-300 dark:text-zinc-700 origin-center"
                            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                            {config.labelEn}
                        </div>
                    </div>
                ))}

                {/* Agent Nodes */}
                {Object.entries(AGENT_UI_MAP).map(([agentId, agent]) => {
                    const status = agentStatuses[agentId];
                    const isWorking = activeAgentId
                        ? (activeAgentId === agentId)
                        : (status === 'working');
                    const isDone = status === 'done';
                    const isGovernor = agent.layer === 'governor';

                    return (
                        <motion.div
                            key={agentId}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{
                                scale: isWorking ? 1.06 : 1,
                                opacity: 1,
                                boxShadow: isWorking
                                    ? (isDark ? '0 0 40px rgba(255,255,255,0.05)' : '0 25px 50px -12px rgba(0,0,0,0.15)')
                                    : 'none'
                            }}
                            className={`absolute w-56 p-5 rounded-[2.5rem] border-2 transition-all duration-700 backdrop-blur-2xl ${isWorking
                                ? 'border-blue-500 dark:border-blue-400 bg-white dark:bg-zinc-900 z-20 shadow-[0_0_50px_rgba(59,130,246,0.2)]'
                                : isGovernor
                                    ? 'border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60'
                                    : 'border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40'
                                }`}
                            style={{ left: agent.x, top: agent.y }}
                        >
                            <div className="flex items-center space-x-4">
                                <div className={`p-3 rounded-2xl shadow-inner transition-colors ${isWorking
                                    ? 'bg-blue-500 text-white dark:bg-blue-400 dark:text-zinc-900'
                                    : isGovernor
                                        ? `${agent.color} text-white opacity-80`
                                        : 'bg-zinc-100 dark:bg-zinc-800 opacity-50 text-zinc-500'
                                    }`}>
                                    <agent.icon className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase opacity-40 tracking-widest text-zinc-900 dark:text-zinc-100">
                                        {agent.role}
                                    </div>
                                    <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                                        {agent.name}
                                    </div>
                                </div>
                            </div>

                            {isWorking && (
                                <div className="mt-3 text-center">
                                    <div className="text-[10px] font-black text-blue-500 dark:text-blue-400 animate-pulse uppercase tracking-[0.2em]">
                                        PROCEEDING...
                                    </div>
                                </div>
                            )}

                            {isDone && !isWorking && (
                                <div className="flex justify-center mt-2">
                                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                                </div>
                            )}

                            {/* Phase badge */}
                            {!isWorking && !isDone && (
                                <div className="mt-2 flex justify-end">
                                    <span className="text-[8px] font-bold tracking-wider text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800/50 px-2 py-0.5 rounded-full">
                                        {agent.phase}
                                    </span>
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </motion.div>

        </div>
    );
}
