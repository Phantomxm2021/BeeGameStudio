import { useRef } from 'react';
import { FileText, Loader2, Paperclip, Sparkles, X } from 'lucide-react';
import type { ChatAttachmentPayload } from '../../../services/api';
import { CHAT_ATTACHMENT_ACCEPT, filesToChatAttachments } from '../../../services/chatAttachments';

interface IdeaPromptFormProps {
    value: string;
    placeholder: string;
    generateLabel: string;
    isTransitioning: boolean;
    onChange: (value: string) => void;
    onSubmit: (event: React.FormEvent) => void;
    attachments: ChatAttachmentPayload[];
    onAttachmentsChange: (attachments: ChatAttachmentPayload[]) => void;
}

export function IdeaPromptForm({
    value,
    placeholder,
    generateLabel,
    isTransitioning,
    onChange,
    onSubmit,
    attachments,
    onAttachmentsChange,
}: IdeaPromptFormProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleFiles = async (files: File[]) => {
        const nextAttachments = await filesToChatAttachments(files);
        if (nextAttachments.length > 0) onAttachmentsChange([...attachments, ...nextAttachments]);
    };
    return (
        <form
            onSubmit={onSubmit}
            className="relative z-10 flex w-full justify-center"
        >
            <div
                data-testid="idea-prompt-surface"
                    className="relative w-full max-w-3xl overflow-visible rounded-xl border border-border bg-surface-2 p-2 text-foreground shadow-sm"
                >
                {attachments.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto border-b border-border px-2 pb-2" data-testid="landing-attachments">
                        {attachments.map((attachment, index) => (
                            <div key={`${attachment.filename || attachment.type}-${index}`} className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
                                {attachment.type === 'image' ? <img src={`data:${attachment.mediaType};base64,${attachment.data}`} alt={attachment.filename || 'image'} className="h-8 w-8 rounded-lg object-cover" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                                <span className="max-w-40 truncate">{attachment.filename}</span>
                                <button type="button" aria-label={`Remove ${attachment.filename || 'attachment'}`} onClick={() => onAttachmentsChange(attachments.filter((_, itemIndex) => itemIndex !== index))} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                            </div>
                        ))}
                    </div>
                ) : null}
                <textarea
                    aria-label={placeholder}
                    className="min-h-24 w-full resize-y bg-transparent px-3 py-2 text-[16px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-20 min-[900px]:text-md"
                    placeholder={placeholder}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                        }
                    }}
                    disabled={isTransitioning}
                    autoFocus
                />
                <div className="flex items-center justify-between gap-3 border-t border-border px-1 pt-2">
                    <button
                        type="button"
                        aria-label="Upload attachment"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isTransitioning}
                        className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Paperclip className="h-4 w-4" />
                    </button>
                    <input ref={fileInputRef} id="landing-attachment-upload" type="file" accept={CHAT_ATTACHMENT_ACCEPT} multiple className="hidden" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void handleFiles(files); }} disabled={isTransitioning} />
                    <button
                        type="submit"
                        disabled={(!value.trim() && attachments.length === 0) || isTransitioning}
                        className={`flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed sm:px-5 ${isTransitioning ? 'opacity-80' : 'hover:opacity-90 disabled:opacity-50'
                            }`}
                    >
                        <span className={`text-sm font-medium ${isTransitioning ? 'text-primary-foreground/70' : 'text-primary-foreground'}`}>{generateLabel}</span>
                        {isTransitioning ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary-foreground/70" />
                        ) : (
                            <Sparkles className="h-4 w-4" />
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
}
