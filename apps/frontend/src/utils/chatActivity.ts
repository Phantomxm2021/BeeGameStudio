type Activity = {
  taskId?: string; task_id?: string; turnId?: string; timestamp: number;
  streamStatus?: string; toolStatus?: string; isSubagentTool?: boolean;
  completionReason?: 'stopped' | 'failed' | 'incomplete';
};

/** A follow-up native turn can be running after its delivery workflow ended. */
export function isProjectExecutionActive(status?: {
  phase?: string;
  workflow?: unknown;
} | null): boolean {
  const workflow = status?.workflow;
  const workflowStatus = workflow && typeof workflow === 'object' && 'status' in workflow
    ? workflow.status : undefined;
  return ['starting', 'queued', 'running', 'resuming', 'waiting_approval'].includes(status?.phase ?? '') ||
    (typeof workflowStatus === 'string' && ['running', 'verifying'].includes(workflowStatus));
}

/** Parent completion is not child completion. Consume the canonical child
 * lifecycle, including terminal outcomes restored from transcript history. */
export function hasActiveSubagents(messages: ReadonlyArray<Pick<Activity, 'isSubagentTool' | 'toolStatus' | 'completionReason'>>): boolean {
  return messages.some(message => message.isSubagentTool === true &&
    message.toolStatus === 'running' && !message.completionReason);
}

/** A terminal turn settles only its own unfinished activity. A completed
 * parent turn does not imply a detached subagent has completed. */
export function settleChatActivity<T extends Activity>(messages: T[], scope: {
  taskId: string; turnId?: string; at: number; reason: NonNullable<Activity['completionReason']>;
}): T[] {
  return messages.map(message => {
    if ((message.taskId ?? message.task_id) !== scope.taskId ||
      (scope.turnId && message.turnId !== scope.turnId) || message.timestamp > scope.at ||
      (scope.reason === 'incomplete' && message.isSubagentTool)) return message;
    const streaming = message.streamStatus === 'streaming';
    const runningTool = message.toolStatus === 'running';
    if (!streaming && !runningTool) return message;
    return { ...message, completionReason: scope.reason,
      ...(streaming ? { streamStatus: 'complete' } : {}),
      ...(runningTool ? { toolStatus: 'failed' } : {}) };
  });
}
