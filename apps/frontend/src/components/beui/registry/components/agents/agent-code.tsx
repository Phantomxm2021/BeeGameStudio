"use client";

import {
  type CSSProperties,
  Fragment,
  useEffect,
  useState,
} from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { cn } from "@/components/beui/registry/lib/utils";

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript";

/** Unsupported grammars remain literal text rather than failing a response. */
export function agentCodeLanguage(value?: string): AgentCodeLanguage {
  const language = value?.toLowerCase();
  if (["js", "ts", "javascript", "typescript", "mjs", "cjs"].includes(language || "")) return "typescript";
  if (language === "jsx" || language === "tsx") return "tsx";
  if (["sh", "shell", "zsh", "bash"].includes(language || "")) return "bash";
  return language === "json" || language === "diff" ? language : "text";
}

export interface AgentCodeToken {
  content: string;
  offset: number;
  light?: string;
  dark?: string;
}

export type AgentCodeTokenLines = AgentCodeToken[][];

export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
}

const LIGHT_THEME = "github-light-high-contrast";
const DARK_THEME = "github-dark-high-contrast";
let agentCodeHighlighter: Promise<Highlighter> | null = null;
// Keep large outputs as one text node; highlighting is for small code excerpts.
const MAX_HIGHLIGHT_CHARACTERS = 16_000;

function getAgentCodeHighlighter() {
  if (!agentCodeHighlighter) {
    agentCodeHighlighter = createHighlighter({
      themes: [LIGHT_THEME, DARK_THEME],
      langs: ["bash", "diff", "json", "tsx", "typescript"],
    });
  }
  return agentCodeHighlighter;
}

export function useAgentCodeTokens(
  code: string,
  language: AgentCodeLanguage,
) {
  const highlight = language !== "text" && code.length <= MAX_HIGHLIGHT_CHARACTERS;
  // Retain only this mounted block's current tokens, not every streamed version.
  const [result, setResult] = useState<{
    code: string;
    language: AgentCodeLanguage;
    lines: AgentCodeTokenLines;
  } | null>(null);

  useEffect(() => {
    if (!highlight) {
      setResult(null);
      return;
    }
    let cancelled = false;
    getAgentCodeHighlighter().then((highlighter) => {
      if (cancelled) return;
      const lines = highlighter
        .codeToTokensWithThemes(code, {
          lang: language,
          themes: { light: LIGHT_THEME, dark: DARK_THEME },
        })
        .map((line) => line.map((token) => ({
          content: token.content,
          offset: token.offset,
          light: token.variants.light?.color,
          dark: token.variants.dark?.color,
        })));
      setResult({ code, language, lines });
    }).catch(() => {
      if (!cancelled) console.warn("Code highlighting unavailable; displaying plain text.");
    });
    return () => { cancelled = true; };
  }, [code, language, highlight]);

  // Never reuse a tokenized prefix: it can hide a newly appended partial line.
  return highlight && result?.code === code && result.language === language ? result.lines : null;
}

export function AgentCodeLine({
  code,
  tokens,
  className,
}: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark": token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  );
}

export function AgentCode({
  code,
  language = "bash",
  className,
}: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language);
  let offset = 0;
  const lines = tokens ? code.split("\n").map((content) => {
    const line = { content, offset };
    offset += content.length + 1;
    return line;
  }) : [];

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-4 text-foreground/85",
        className,
      )}
    >
      <code>
        {tokens ? lines.map((line, index) => (
          <Fragment key={line.offset}>
            <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        )) : code}
      </code>
    </pre>
  );
}
