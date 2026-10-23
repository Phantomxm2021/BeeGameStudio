import type { ReactNode } from "react";

export type AgentActivityStatus = "working" | "complete";
export type AgentStepStatus = "pending" | "active" | "complete";

export interface AgentActivityStep {
  id: string;
  type: "step";
  label: ReactNode;
  status?: AgentStepStatus;
  meta?: ReactNode;
}

export interface AgentActivityText {
  id: string;
  type: "text";
  content: ReactNode;
}

export interface AgentSearchResult {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
  icon?: ReactNode;
}

export interface AgentActivitySearch {
  id: string;
  type: "search";
  query: ReactNode;
  results?: AgentSearchResult[];
  moreCount?: number;
}

export interface AgentActivityTool {
  id: string;
  type: "tool";
  action: "read" | "edit" | "run" | (string & {});
  target: ReactNode;
  additions?: number;
  deletions?: number;
}

export type AgentTraceKind =
  | "thinking"
  | "message"
  | "write"
  | "run"
  | "read"
  | (string & {});

export interface AgentActivityTrace {
  id: string;
  type: "trace";
  kind: AgentTraceKind;
  label: ReactNode;
  detail?: ReactNode;
  /** Fixed trailing status/duration, separate from the truncated title. */
  meta?: ReactNode;
  icon?: ReactNode;
  /** Inline disclosure content, or open an existing detail panel. */
  content?: ReactNode;
  onSelect?: () => void;
}

export type AgentActivityItem =
  | AgentActivityStep
  | AgentActivityText
  | AgentActivitySearch
  | AgentActivityTool
  | AgentActivityTrace;

export type AgentActivityContentType = AgentActivityItem["type"] | "mixed";

export interface AgentActivityProps {
  /** Timeline keeps a bounded, user-scrollable log and can collapse while working. */
  variant?: "default" | "timeline";
  /** Chronological activity entries. Append or update items as events stream. */
  items: AgentActivityItem[];
  /** Expected activity kind before the first streamed item arrives. */
  contentType?: AgentActivityContentType;
  /** Current run phase. Only the default variant forces active runs open. */
  status?: AgentActivityStatus;
  /** Elapsed run time, in seconds. Used by the step-only summary. */
  duration?: number;
  /** Controlled expanded state; also applies while working in a timeline. */
  open?: boolean;
  /** Initial expanded state. */
  defaultOpen?: boolean;
  /** Called when the completed activity disclosure changes state. */
  onOpenChange?: (open: boolean) => void;
  /** Collapse the disclosure when status changes from working to complete. */
  collapseOnComplete?: boolean;
  /** Optional label shown while the run is active. */
  activeLabel?: ReactNode;
  /** Optional completed summary. Derived from the item types by default. */
  summary?: ReactNode;
  /** Optional renderer for the contents of the active status row. */
  renderWorkingStatus?: (context: {
    label: ReactNode;
    duration: number;
  }) => ReactNode;
  /** Optional renderer for the contents before the built-in disclosure chevron. */
  renderCompletedStatus?: (context: {
    summary: ReactNode;
    duration: number;
  }) => ReactNode;
  /** Maximum visible height; timelines scroll within this cap (default 208px). */
  maxHeight?: number;
  className?: string;
  contentClassName?: string;
}
