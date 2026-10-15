"use client";
// beui.dev/components/agents/prompt-input

import { ArrowUp, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  type ReactNode,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/beui/registry/components/motion/button";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/components/beui/registry/components/motion/popover-morph";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/beui/registry/components/motion/select";
import { SPRING_SWAP } from "@/components/beui/registry/lib/ease";
import { cn } from "@/components/beui/registry/lib/utils";

export interface PromptModel {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptAction {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptInputProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "onChange" | "onSubmit" | "children"
> {
  textareaRef?: Ref<HTMLTextAreaElement>;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  models?: PromptModel[];
  model?: string;
  defaultModel?: string;
  onModelChange?: (model: string) => void;
  actions?: PromptAction[];
  onAction?: (action: string) => void;
  onSubmit?: (value: string, model?: string) => void | Promise<void>;
  loading?: boolean;
  /** Let a non-empty draft replace Stop with Send while a turn is running. */
  allowSubmitWhileLoading?: boolean;
  stopDisabled?: boolean;
  onStop?: () => void;
  submitLabel?: string;
  stopLabel?: string;
  /** Allow an empty prompt when the surrounding adapter has attachments to submit. */
  allowEmptySubmit?: boolean;
  compact?: boolean;
  minRows?: number;
  maxRows?: number;
  /** Applies the same typography to the textarea and its hidden size-measurement mirror. */
  textClassName?: string;
  leadingAction?: ReactNode;
  className?: string;
}

export function PromptInput({
  value,
  defaultValue = "",
  onValueChange,
  models = [],
  model,
  defaultModel,
  onModelChange,
  actions = [],
  onAction,
  onSubmit,
  loading = false,
  allowSubmitWhileLoading = false,
  stopDisabled,
  onStop,
  submitLabel = "Send prompt",
  stopLabel = "Stop generating",
  allowEmptySubmit = false,
  compact = false,
  minRows = 2,
  maxRows = 8,
  textClassName = "type-input",
  leadingAction,
  className,
  textareaRef: externalTextareaRef,
  disabled,
  placeholder = "Ask the agent to do something…",
  "aria-label": ariaLabel = "Prompt",
  onKeyDown,
  ...textareaProps
}: PromptInputProps) {
  const reduce = useReducedMotion() ?? false;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalModel, setInternalModel] = useState(
    defaultModel ?? models[0]?.value,
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const currentValue = value ?? internalValue;
  const currentModelValue = model ?? internalModel;
  const currentModel = models.find(
    (option) => option.value === currentModelValue,
  );
  const hasDraft = Boolean(currentValue.trim()) || allowEmptySubmit;
  const canSubmit = hasDraft && !disabled && (!loading || allowSubmitWhileLoading);
  const showStop = loading && Boolean(onStop) && (!allowSubmitWhileLoading || !hasDraft || disabled);

  useEffect(() => {
    if (!externalTextareaRef) return;
    if (typeof externalTextareaRef === "function") {
      externalTextareaRef(textareaRef.current);
      return;
    }
    externalTextareaRef.current = textareaRef.current;
    return () => {
      externalTextareaRef.current = null;
    };
  }, [externalTextareaRef]);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    const measurement = measurementRef.current;
    if (!textarea || (!compact && !measurement) || textarea.value !== currentValue) return;

    if (compact) textarea.style.height = "auto";

    const lineHeight = 24;
    const nextHeight = Math.min(
      Math.max(compact ? textarea.scrollHeight : measurement!.scrollHeight, minRows * lineHeight),
      maxRows * lineHeight,
    );
    const height = `${nextHeight}px`;
    if (textarea.style.height !== height) textarea.style.height = height;
  }, [compact, currentValue, maxRows, minRows]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeTextarea);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const setModel = (next: string) => {
    if (model === undefined) setInternalModel(next);
    onModelChange?.(next);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = currentValue.trim();
    if ((!prompt && !allowEmptySubmit) || disabled || (loading && !allowSubmitWhileLoading)) return;

    onSubmit?.(prompt, currentModelValue);
    if (value === undefined) setInternalValue("");
    textareaRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "relative w-full border border-border/80 bg-background transition-colors focus-within:border-foreground/25",
        compact ? "flex min-h-12 items-end gap-2 rounded-[24px] px-2 py-1.5" : "rounded-[10px] p-2",
        disabled && "opacity-60",
        className,
      )}
    >
      {!compact ? <div
        ref={measurementRef}
        aria-hidden="true"
        className={cn(textClassName, "pointer-events-none invisible absolute inset-x-2 top-0 whitespace-pre-wrap px-2 [overflow-wrap:break-word]")}
      >
        {`${currentValue}\u200b`}
      </div> : null}
      {compact ? leadingAction : null}
      <textarea
        ref={textareaRef}
        value={currentValue}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={minRows}
        {...textareaProps}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        className={cn(textClassName, "scrollbar-hide block resize-none overflow-y-auto bg-transparent text-foreground outline-none placeholder:text-muted-foreground/55", compact ? "min-w-0 flex-1 px-1 py-0" : "w-full px-2 pt-1.5")}
      />

      <div className={cn("flex min-h-8 items-center gap-1", compact ? "shrink-0" : "mt-1")}>
        {actions.length ? (
          <MorphPopover open={actionsOpen} onOpenChange={setActionsOpen}>
            <MorphPopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || loading}
                aria-label="Add to prompt"
                className="size-8 rounded-full"
              >
                <motion.span
                  aria-hidden="true"
                  animate={{ rotate: actionsOpen ? 45 : 0 }}
                  transition={reduce ? { duration: 0 } : SPRING_SWAP}
                >
                  <Plus className="size-4" />
                </motion.span>
              </Button>
            </MorphPopoverTrigger>

            <MorphPopoverContent
              side="top"
              align="start"
              sideOffset={8}
              radius={12}
              className="w-56 p-1.5"
            >
              {actions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    onAction?.(action.value);
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  {action.icon ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {action.label}
                    </span>
                    {action.description ? (
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </MorphPopoverContent>
          </MorphPopover>
        ) : null}
        {!compact ? leadingAction : null}
        {models.length ? (
          <Select
            value={currentModelValue}
            onValueChange={setModel}
            disabled={disabled || loading}
            className="min-w-0"
          >
            <SelectTrigger className="h-8 w-auto max-w-52 rounded-xl border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted focus-visible:ring-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {currentModel?.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">
                    {currentModel.icon}
                  </span>
                ) : null}
                <span className="truncate text-muted-foreground">
                  {currentModel?.label ?? "Choose model"}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent className="right-auto w-52 shadow-none">
              {models.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon ? (
                      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {option.label}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Button
          type={showStop ? "button" : "submit"}
          size="icon"
          disabled={showStop ? (stopDisabled ?? disabled) : !canSubmit}
          aria-label={showStop ? stopLabel : submitLabel}
          onClick={showStop ? onStop : undefined}
          className="ml-auto size-8 rounded-full"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={showStop ? "stop" : "send"}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="grid place-items-center"
            >
              {showStop ? (
                <Square className="size-3 fill-current" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </form>
  );
}
