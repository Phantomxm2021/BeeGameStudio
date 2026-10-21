"use client";
// beui.dev/components/agents/agent-activity

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ThinkingShimmer } from "@/components/beui/registry/components/agents/loading-states/thinking-shimmer";
import { AgentDisclosure } from "@/components/beui/registry/components/agents/agent-disclosure";
import {
  EASE_OUT,
  SPRING_LAYOUT,
  SPRING_SWAP,
} from "@/components/beui/registry/lib/ease";
import { cn } from "@/components/beui/registry/lib/utils";
import { ActivityRow } from "./activity-row";
import type {
  AgentActivityContentType,
  AgentActivityItem,
  AgentActivityProps,
} from "./types";

export type {
  AgentActivityContentType,
  AgentActivityItem,
  AgentActivityProps,
  AgentActivitySearch,
  AgentActivityStatus,
  AgentActivityStep,
  AgentActivityText,
  AgentActivityTool,
  AgentActivityTrace,
  AgentSearchResult,
  AgentStepStatus,
  AgentTraceKind,
} from "./types";

function formatDuration(duration: number) {
  const seconds = Math.max(0, Math.round(duration));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function useControllableOpen({
  open,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const currentOpen = open ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  return [currentOpen, setOpen] as const;
}

function getContentType(items: AgentActivityItem[]): AgentActivityContentType {
  const first = items[0]?.type;
  return first && items.every((item) => item.type === first) ? first : "mixed";
}

function getActiveLabel(type: AgentActivityContentType) {
  if (type === "search") return "Searching the web…";
  if (type === "tool") return "Running tools…";
  if (type === "trace") return "Working through the run…";
  if (type === "mixed") return "Working through it…";
  return "Thinking…";
}

function getSummary(
  type: AgentActivityContentType,
  items: AgentActivityItem[],
  duration: number,
): ReactNode {
  if (type === "step" || type === "text") {
    return (
      <>
        Thought for <span className="tabular-nums">{formatDuration(duration)}</span>
      </>
    );
  }
  if (type === "search") return "Searched the web";
  if (type === "tool") {
    return `Ran ${items.length} ${items.length === 1 ? "tool" : "tools"}`;
  }
  if (type === "trace") {
    const messages = items.filter(
      (item) =>
        item.type === "trace" &&
        (item.kind === "thinking" || item.kind === "message"),
    ).length;
    const tools = items.length - messages;
    return `${tools} ${tools === 1 ? "tool call" : "tool calls"}, ${messages} ${messages === 1 ? "message" : "messages"}`;
  }
  return `Completed ${items.length} ${items.length === 1 ? "step" : "steps"}`;
}

export function AgentActivity({
  variant = "default",
  items,
  contentType: initialContentType,
  status = "working",
  duration = 0,
  open,
  defaultOpen = false,
  onOpenChange,
  collapseOnComplete = true,
  activeLabel,
  summary,
  renderWorkingStatus,
  renderCompletedStatus,
  maxHeight = 208,
  className,
  contentClassName,
}: AgentActivityProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousStatus = useRef(status);
  const [contentHeight, setContentHeight] = useState(0);
  const [currentOpen, setOpen] = useControllableOpen({
    open,
    defaultOpen,
    onOpenChange,
  });
  const working = status === "working";
  const timeline = variant === "timeline";
  const expanded = timeline ? currentOpen : working || currentOpen;
  const contentType = items.length
    ? getContentType(items)
    : (initialContentType ?? "mixed");
  const cappedHeight = Math.min(contentHeight, Math.max(0, maxHeight));
  // Keep short working activities compact; only cap the viewport once the
  // streamed content actually exceeds the beUI maximum height.
  const viewportHeight = timeline ? contentHeight : cappedHeight;
  const capped = !timeline && contentHeight > maxHeight;
  const streamOffset = working && !timeline
    ? Math.min(0, viewportHeight - contentHeight)
    : 0;

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const measure = () => setContentHeight(node.offsetHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [timeline]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!timeline || !working || !currentOpen || !following.current || !viewport) return;
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  }, [timeline, working, currentOpen, contentHeight]);

  useEffect(() => {
    if (previousStatus.current === "working" && status === "complete" && (!timeline || collapseOnComplete)) {
      setOpen(!collapseOnComplete || (timeline && !following.current));
    }
    previousStatus.current = status;
  }, [collapseOnComplete, setOpen, status, timeline]);

  const toggle = () => {
    const next = !currentOpen;
    setOpen(next);
    if (next) requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0 }));
  };

  const liveLabel = activeLabel ?? getActiveLabel(contentType);
  const completedSummary = summary ?? getSummary(contentType, items, duration);
  const maskImage = capped
    ? working
      ? "linear-gradient(to bottom, transparent, black 12px)"
      : "linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent)"
    : undefined;

  return (
    <div
      data-state={working ? "working" : expanded ? "open" : "closed"}
      data-content={contentType}
      data-variant={variant}
      aria-busy={working}
      className={cn("w-full text-sm", timeline && "py-1 text-[15px]", className)}
    >
      {working && !timeline ? (
        <div
          id={triggerId}
          role="status"
          className="flex h-7 min-w-0 items-center text-muted-foreground"
        >
          {renderWorkingStatus
            ? renderWorkingStatus({ label: liveLabel, duration })
            : <ThinkingShimmer>{liveLabel}</ThinkingShimmer>}
        </div>
      ) : (
        <button
          id={triggerId}
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggle}
          className={cn("group flex h-7 min-w-0 items-center gap-1.5 rounded-md text-left font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", timeline && "h-auto min-h-7 gap-2 py-1 font-normal")}
        >
          <span className="truncate">
            {working ? (renderWorkingStatus ? renderWorkingStatus({ label: liveLabel, duration }) : liveLabel) : renderCompletedStatus
              ? renderCompletedStatus({ summary: completedSummary, duration })
              : completedSummary}
          </span>
          <motion.span
            aria-hidden="true"
            animate={{ rotate: timeline ? (expanded ? 0 : -90) : (expanded ? 180 : 0) }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="inline-flex shrink-0 text-muted-foreground/70 group-hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        </button>
      )}

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={expanded}
        openHeight={timeline ? "auto" : viewportHeight}
      >
        <div
          ref={viewportRef}
          onWheel={event => { if (timeline && event.deltaY < 0) following.current = false; }}
          onFocusCapture={() => { if (timeline) following.current = false; }}
          onScroll={event => { if (timeline) { const node = event.currentTarget; following.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 2; } }}
          tabIndex={timeline && expanded ? 0 : undefined}
          className={cn(
            "pr-1",
            timeline ? "overflow-y-auto overscroll-y-contain focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              : cn("scrollbar-hide", capped && expanded && !working ? "overflow-y-auto" : "overflow-y-hidden"),
          )}
          style={{ height: timeline ? undefined : viewportHeight, maxHeight: timeline ? Math.max(0, maxHeight) : undefined, maskImage, WebkitMaskImage: maskImage }}
        >
          <motion.div
            ref={contentRef}
            role="list"
            initial={false}
            animate={{ y: streamOffset }}
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            className={cn("space-y-0.5 py-2", timeline && "my-2 ml-1 border-l-2 border-foreground/10 py-0 pl-4", contentClassName)}
          >
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <motion.div
                  layout="position"
                  key={item.id}
                  role="listitem"
                  initial={timeline ? false : reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          opacity: { duration: 0.18, ease: EASE_OUT },
                          y: SPRING_LAYOUT,
                          layout: SPRING_LAYOUT,
                        }
                  }
                >
                  <ActivityRow item={item} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </AgentDisclosure>
    </div>
  );
}
