export type BeeGameNativeTaskNotification = {
  value: string
  uuid?: string
  isMeta?: boolean
  /** Unmodified structured SDK event, including foreground notifications. */
  message?: Record<string, unknown>
  /** Observation only, supplied when no foreground turn is consuming messages. */
  backgroundMessage?: Record<string, unknown>
}
