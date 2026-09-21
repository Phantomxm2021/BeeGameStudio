type Activity = {
  taskId?: string; task_id?: string; turnId?: string; timestamp: number;
  streamStatus?: string; toolStatus?: string; isSubagentTool?: boolean;
  completionReason?: 'stopped' | 'failed' | 'incomplete';
};

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
