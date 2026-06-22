import { memo } from 'react';
import { motion } from 'framer-motion';
import { ListTodo, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { formatTaskId } from '../../../utils/formatters';
import type { ProjectTask } from '../../../store/systemStore';
import { TASK_STATUS_COLORS, getCanonicalTaskStatus, getTaskStatusLabel } from './SidebarUtils';

interface TasksPanelProps {
    tasks: ProjectTask[];
    filteredTasks: ProjectTask[];
    taskFilter: 'all' | 'review' | 'verification' | 'invalidated';
    onSetTaskFilter: (filter: 'all' | 'review' | 'verification' | 'invalidated') => void;
}

export const TasksPanel = memo(({ 
    tasks, 
    filteredTasks, 
    taskFilter, 
    onSetTaskFilter 
}: TasksPanelProps) => {
    return (
        <div className="h-full overflow-y-auto p-8 scrollbar-hide">
            <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Active Project Task Map</div>
                <div className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[9px] font-bold text-zinc-900 dark:text-zinc-100">{filteredTasks.length}/{tasks.length} Units</div>
            </div>
            
            <div className="flex flex-wrap gap-2 mb-4">
                {([
                    ['all', 'All'],
                    ['review', 'Review'],
                    ['verification', 'Verify'],
                    ['invalidated', 'Invalid'],
                ] as const).map(([value, label]) => (
                    <button
                        key={value}
                        onClick={() => onSetTaskFilter(value)}
                        className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wide transition-colors ${taskFilter === value
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                            }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-20 italic space-y-4">
                    <ListTodo className="w-12 h-12" />
                    <div className="text-sm">No tasks match this view...</div>
                </div>
            ) : (
                filteredTasks.map((task, idx) => {
                    const lifecycleStatus = getCanonicalTaskStatus(task);
                    const isRunning = ['in_progress', 'in_review', 'verified'].includes(lifecycleStatus);
                    const isCompleted = lifecycleStatus === 'released';
                    const topCandidate = task.candidate_agents?.[0];
                    const artifactVersionSummary = task.artifact_versions?.map((art) => `${art.artifact_type} v${art.version}`).slice(0, 2) || [];

                    return (
                        <motion.div
                            key={task.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className={`p-4 rounded-2xl border ${isRunning
                                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent shadow-xl'
                                : 'bg-white/50 dark:bg-zinc-800/40 border-zinc-100 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100'
                                }`}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                    {isCompleted ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                    ) : isRunning ? (
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                        >
                                            <Clock className="w-4 h-4 opacity-70" />
                                        </motion.div>
                                    ) : (
                                        <div className="w-4 h-4 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />
                                    )}
                                    <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                        {formatTaskId(task.id)}
                                    </span>
                                </div>
                                <div className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase transition-colors duration-300 ${TASK_STATUS_COLORS[lifecycleStatus] || 'bg-zinc-100 text-zinc-500'}`}>
                                    {getTaskStatusLabel(task)}
                                </div>
                            </div>
                            <div className="text-sm font-bold mb-1">{task.summary}</div>
                            <div className="flex flex-wrap gap-2 mb-2 text-[9px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                {task.phase && <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{task.phase}</span>}
                                {task.execution_mode && <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{task.execution_mode}</span>}
                                {task.review_stage && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{task.review_stage}</span>}
                                {task.verification_stage && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{task.verification_stage}</span>}
                            </div>
                            {task.assignee && (
                                <div className="flex items-center space-x-2 text-zinc-500 dark:text-zinc-400 text-[10px]">
                                    <span>By @{task.assignee}</span>
                                    {task.depends_on.length > 0 && (
                                        <>
                                            <span>•</span>
                                            <div className="flex items-center">
                                                <ArrowRight className="w-2.5 h-2.5 mr-1" />
                                                <span>{task.depends_on.length} Deps</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            {(task.swarm_parent || task.micro_swarm_specialist || topCandidate || task.invalidated_reason || artifactVersionSummary.length > 0) && (
                                <div className="mt-3 space-y-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                    {task.swarm_parent && (
                                        <div>Swarm: <span className="font-semibold text-zinc-700 dark:text-zinc-200">@{task.swarm_parent}</span>{task.micro_swarm_specialist ? ` / ${task.micro_swarm_specialist}` : ''}</div>
                                    )}
                                    {topCandidate && (
                                        <div>Best Claim: <span className="font-semibold text-zinc-700 dark:text-zinc-200">@{topCandidate.agent_id}</span> {typeof topCandidate.claim_score === 'number' ? `(${topCandidate.claim_score.toFixed(2)})` : ''}</div>
                                    )}
                                    {artifactVersionSummary.length > 0 && (
                                        <div>Artifacts: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{artifactVersionSummary.join(', ')}</span></div>
                                    )}
                                    {task.invalidated_reason && (
                                        <div className="text-orange-600 dark:text-orange-300">Invalidated: {task.invalidated_reason}</div>
                                    )}
                                </div>
                            )}
                            {task.candidate_agents && task.candidate_agents.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700/60">
                                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-2">
                                        Team OS Debug
                                    </div>
                                    <div className="space-y-1.5">
                                        {task.candidate_agents.slice(0, 4).map((candidate) => (
                                            <div
                                                key={`${task.id}-${candidate.agent_id}`}
                                                className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400"
                                            >
                                                <span className="truncate pr-3">
                                                    @{candidate.agent_id}
                                                    {candidate.claimability_reason ? ` · ${candidate.claimability_reason}` : ''}
                                                </span>
                                                <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                                                    {candidate.claim_score.toFixed(2)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    );
                })
            )}
            </div>
        </div>
    );
});

TasksPanel.displayName = 'TasksPanel';
