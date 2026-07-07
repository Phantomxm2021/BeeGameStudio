import { ChevronDown, Loader2, Paperclip, Sparkles } from 'lucide-react';
import type { BeeGameThinkingMode } from '../../../services/beeGameAdapter';

function ShinyText({ text, disabled = false, speed = 5, className = "" }: { text: string; disabled?: boolean; speed?: number; className?: string }) {
    return (
        <span
            className={`bg-clip-text inline-block ${className}`}
            style={{
                color: 'rgba(236, 236, 236, 0.65)',
                backgroundImage: 'linear-gradient(120deg, rgba(255, 255, 255, 0) 40%, rgba(255, 255, 255, 0.8) 50%, rgba(255, 255, 255, 0) 60%)',
                backgroundSize: '200% 100%',
                WebkitBackgroundClip: 'text',
                animation: disabled ? 'none' : `shine ${speed}s linear infinite`,
            }}
        >
            {text}
        </span>
    );
}

interface IdeaPromptFormProps {
    value: string;
    placeholder: string;
    generateLabel: string;
    thinkingMode: BeeGameThinkingMode;
    thinkingLabel: string;
    thinkingOptions: Array<{ value: BeeGameThinkingMode; label: string }>;
    isTransitioning: boolean;
    onChange: (value: string) => void;
    onThinkingModeChange: (value: BeeGameThinkingMode) => void;
    onSubmit: (event: React.FormEvent) => void;
}

export function IdeaPromptForm({
    value,
    placeholder,
    generateLabel,
    thinkingMode,
    thinkingLabel,
    thinkingOptions,
    isTransitioning,
    onChange,
    onThinkingModeChange,
    onSubmit,
}: IdeaPromptFormProps) {
    return (
        <form
            onSubmit={onSubmit}
            className="relative z-10 flex w-full justify-center px-4 sm:px-6"
        >
            <div
                data-testid="idea-prompt-surface"
                data-surface="frosted-glass"
                data-style-source="pixelfork"
                data-glass-density="reinforced"
                className="input-surface relative w-full max-w-[760px] overflow-visible rounded-full px-1 shadow-[0_22px_70px_rgba(0,0,0,0.32)]"
            >
                <div className="relative z-10 flex h-[66px] items-center gap-2 rounded-full px-3 py-3 sm:h-[72px]">
                    <button
                        type="button"
                        aria-label="Upload attachment"
                        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full glass-icon-button p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 active:scale-95"
                    >
                        <span className="relative block h-6 w-6" aria-hidden="true">
                            <Paperclip className="h-6 w-6" />
                        </span>
                    </button>

                    <input
                        className="type-input my-auto min-w-0 flex-1 bg-transparent py-0 text-zinc-300 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder={placeholder}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        disabled={isTransitioning}
                        autoFocus
                    />

                    <div className="group relative flex h-10 w-fit shrink-0 items-center rounded-full px-2 transition-colors hover:bg-white/[0.06]">
                        <select
                            aria-label={thinkingLabel}
                            value={thinkingMode}
                            onChange={(event) => {
                                onThinkingModeChange(event.target.value as BeeGameThinkingMode);
                                event.currentTarget.blur();
                            }}
                            disabled={isTransitioning}
                            className="type-button h-full w-auto cursor-pointer appearance-none bg-transparent pl-0 pr-5 text-zinc-300 outline-none transition-colors hover:text-white focus-visible:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {thinkingOptions.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition-colors group-hover:text-zinc-100" aria-hidden="true" />
                    </div>

                    <button
                        type="submit"
                        disabled={!value.trim() || isTransitioning}
                        className={`type-button flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 active:scale-95 disabled:cursor-not-allowed sm:px-5 ${isTransitioning ? 'bg-white/10 opacity-100' : 'bg-white/10 hover:bg-white/15 disabled:opacity-50'
                            }`}
                    >
                        <ShinyText text={generateLabel} disabled={!isTransitioning} speed={0.5} />
                        {isTransitioning ? (
                            <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
                        ) : (
                            <Sparkles className="h-4 w-4" />
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
}
