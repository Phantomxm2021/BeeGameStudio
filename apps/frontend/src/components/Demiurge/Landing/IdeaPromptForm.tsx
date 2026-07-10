import { FileText, Loader2, Paperclip, Sparkles, X } from 'lucide-react';
import type { BeeGameThinkingMode } from '../../../services/beeGameAdapter';
import type { ChatAttachmentPayload } from '../../../services/api';
import { CHAT_ATTACHMENT_ACCEPT, filesToChatAttachments } from '../../../services/chatAttachments';
import { ThinkingModeSelect } from '../ThinkingModeSelect';

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
    attachments: ChatAttachmentPayload[];
    onAttachmentsChange: (attachments: ChatAttachmentPayload[]) => void;
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
    attachments,
    onAttachmentsChange,
}: IdeaPromptFormProps) {
    const handleFiles = async (files: File[]) => {
        const nextAttachments = await filesToChatAttachments(files);
        if (nextAttachments.length > 0) onAttachmentsChange([...attachments, ...nextAttachments]);
    };
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
                {attachments.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto px-4 pt-3" data-testid="landing-attachments">
                        {attachments.map((attachment, index) => (
                            <div key={`${attachment.filename || attachment.type}-${index}`} className="type-caption-2 flex shrink-0 items-center gap-2 rounded-2xl border border-white/15 bg-black/20 px-3 py-2 text-zinc-200">
                                {attachment.type === 'image' ? <img src={`data:${attachment.mediaType};base64,${attachment.data}`} alt={attachment.filename || 'image'} className="h-8 w-8 rounded-lg object-cover" /> : <FileText className="h-4 w-4 text-zinc-400" />}
                                <span className="max-w-40 truncate">{attachment.filename}</span>
                                <button type="button" aria-label={`Remove ${attachment.filename || 'attachment'}`} onClick={() => onAttachmentsChange(attachments.filter((_, itemIndex) => itemIndex !== index))} className="text-zinc-400 hover:text-white"><X className="h-3.5 w-3.5" /></button>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div className="relative z-10 flex h-[66px] items-center gap-2 rounded-full px-3 py-3 sm:h-[72px]">
                    <label
                        htmlFor="landing-attachment-upload"
                        aria-label="Upload attachment"
                        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full glass-icon-button p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 active:scale-95"
                    >
                        <span className="relative block h-6 w-6" aria-hidden="true">
                            <Paperclip className="h-6 w-6" />
                        </span>
                    </label>
                    <input id="landing-attachment-upload" type="file" accept={CHAT_ATTACHMENT_ACCEPT} multiple className="hidden" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void handleFiles(files); }} disabled={isTransitioning} />

                    <input
                        className="type-input my-auto min-w-0 flex-1 bg-transparent py-0 text-zinc-300 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder={placeholder}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        disabled={isTransitioning}
                        autoFocus
                    />

                    <ThinkingModeSelect
                        label={thinkingLabel}
                        value={thinkingMode}
                        options={thinkingOptions}
                        disabled={isTransitioning}
                        onChange={onThinkingModeChange}
                    />

                    <button
                        type="submit"
                        disabled={(!value.trim() && attachments.length === 0) || isTransitioning}
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
