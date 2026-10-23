type Activity = {
  taskId?: string; task_id?: string; turnId?: string; timestamp: number;
  streamStatus?: string; toolStatus?: string; isSubagentTool?: boolean;
  turnCompletedAt?: number;
  completionReason?: 'stopped' | 'failed' | 'incomplete';
};

/** The server runtime phase is the source of truth for active project work. */
export function isProjectExecutionActive(status?: {
  phase?: string;
} | null): boolean {
  return ['starting', 'queued', 'running', 'resuming', 'waiting_approval'].includes(status?.phase ?? '');
}

/** A terminal turn settles only its own unfinished activity. A completed
 * parent turn does not imply a detached subagent has completed. */
export function settleChatActivity<T extends Activity>(messages: T[], scope: {
  taskId: string; turnId?: string; at: number; reason: NonNullable<Activity['completionReason']>;
  completedAt?: number;
  includeSubagents?: boolean;
}): T[] {
  return messages.map(message => {
    if ((message.taskId ?? message.task_id) !== scope.taskId ||
      (scope.turnId && message.turnId !== scope.turnId) || message.timestamp > scope.at ||
      (scope.reason === 'incomplete' && message.isSubagentTool && !scope.includeSubagents)) return message;
    const streaming = message.streamStatus === 'streaming';
    const runningTool = message.toolStatus === 'running';
    if (!streaming && !runningTool && scope.completedAt === undefined) return message;
    return { ...message,
      ...(streaming || runningTool ? { completionReason: scope.reason } : {}),
      ...(scope.completedAt !== undefined && message.turnCompletedAt === undefined ? { turnCompletedAt: scope.completedAt } : {}),
      ...(streaming ? { streamStatus: 'complete' } : {}),
      ...(runningTool ? { toolStatus: 'failed' } : {}) };
  });
}
