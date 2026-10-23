import { ChevronRight } from 'lucide-react';
import { MagneticButton } from '../../beui/registry/components/motion/button/magnetic';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Video, X } from 'lucide-react';
import type { ChatAttachmentPayload } from '../../../services/api';
import { filesToChatAttachments, isSupportedChatFile, MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_TOTAL_BYTES } from '../../../services/chatAttachments';
import { CommandBar } from '../../beui/CommandBar';
import styles from './IdeaPromptForm.module.css';

interface IdeaPromptFormProps {
    value: string;
    placeholder: string;
    generateLabel: string;
    isTransitioning: boolean;
    onChange: (value: string) => void;
    onFocusChange?: (focused: boolean) => void;
    onSubmit: (event: React.FormEvent) => void;
    attachments: ChatAttachmentPayload[];
    onAttachmentsChange: (attachments: ChatAttachmentPayload[]) => void;
    billingConfirmation?: {
        title: string;
        summary: string;
        notice: string;
        confirmLabel: string;
        cancelLabel: string;
        onConfirm: () => void;
        onCancel: () => void;
    };
}

const LANDING_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.doc,.md,.pdf,.mp4';
const IMAGE_LIMIT = 3 * 1024 * 1024;
const DOCUMENT_LIMIT = 2 * 1024 * 1024;
const VIDEO_LIMIT = 10 * 1024 * 1024; // The project attachment API has the same per-file limit.
const VIDEO_DURATION_LIMIT = 10;
const VIDEO_METADATA_TIMEOUT = 10_000;

function readVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(file);
        const cleanup = () => {
            clearTimeout(timer);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.removeAttribute('src');
            URL.revokeObjectURL(url);
        };
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            const duration = video.duration;
            cleanup();
            if (Number.isFinite(duration) && duration > 0) resolve(duration);
            else reject(new Error('Invalid video duration'));
        };
        video.onerror = () => {
            cleanup();
            reject(new Error('Could not read video metadata'));
        };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Video metadata timed out'));
        }, VIDEO_METADATA_TIMEOUT);
        video.src = url;
    });
}

export type CreationMode = 'creative' | 'blueprint';

export function IdeaPromptForm({
    value, placeholder, generateLabel, isTransitioning, onChange, onSubmit, onFocusChange,
    attachments, onAttachmentsChange, billingConfirmation,
}: IdeaPromptFormProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const keyboardSubmitRef = useRef(false);
    const wasConfirmingRef = useRef(false);
    const { t } = useTranslation('landing');
    const fileRef = useRef<HTMLInputElement>(null);
    const [attachmentError, setAttachmentError] = useState('');
    const validateLandingFile = async (file: File): Promise<string | null> => {
        const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        const limit = ['.jpg', '.jpeg', '.png'].includes(extension) ? IMAGE_LIMIT
            : ['.doc', '.md', '.pdf'].includes(extension) ? DOCUMENT_LIMIT
            : extension === '.mp4' ? VIDEO_LIMIT : 0;
        if (!limit) return t('intake.prompt.unsupportedFileTypes');
        if (file.size > limit) return extension === '.mp4'
            ? t('intake.prompt.videoSizeLimit')
            : t('intake.prompt.fileSizeLimit', { name: file.name, size: limit / 1024 / 1024 });
        if (!isSupportedChatFile(file)) return t('intake.prompt.fileTypeMismatch');
        if (extension === '.mp4') {
            try {
                if (await readVideoDuration(file) > VIDEO_DURATION_LIMIT) return t('intake.prompt.videoDurationLimit');
            } catch {
                return t('intake.prompt.videoDurationReadFailed');
            }
        }
        return null;
    };
    useEffect(() => {
        if (billingConfirmation && !wasConfirmingRef.current && keyboardSubmitRef.current) {
            confirmRef.current?.focus();
        } else if (!billingConfirmation && wasConfirmingRef.current && keyboardSubmitRef.current) {
            inputRef.current?.focus();
        }
        wasConfirmingRef.current = Boolean(billingConfirmation);
        if (!billingConfirmation) keyboardSubmitRef.current = false;
    }, [billingConfirmation]);
    const addFiles = async (files: File[]) => {
        setAttachmentError('');
        try {
            if (attachments.length + files.length > MAX_CHAT_ATTACHMENTS ||
                files.reduce((size, file) => size + file.size, 0) + attachments.reduce((size, file) => size + Math.floor(file.data.length * 3 / 4), 0) > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
                setAttachmentError(t('intake.prompt.attachmentCountLimit'));
                return;
            }
            for (const file of files) {
                const error = await validateLandingFile(file);
                if (error) {
                    setAttachmentError(error);
                    return;
                }
            }
            const added = await filesToChatAttachments(files);
            const next = [...attachments, ...added];
            if (added.length) onAttachmentsChange(next);
            else if (files.length) setAttachmentError(t('intake.prompt.unsupportedOrTooLarge'));
        } catch {
            setAttachmentError(t('intake.prompt.attachmentReadFailed'));
        }
    };

    return (
        <form data-dialogue-item className={styles.form}
            onKeyDownCapture={() => { keyboardSubmitRef.current = true; }}
            onPointerDownCapture={() => { keyboardSubmitRef.current = false; }}
            onSubmit={event => {
            if (billingConfirmation || isTransitioning || (!value.trim() && attachments.length === 0)) {
                event.preventDefault();
                return;
            }
            onSubmit(event);
        }}>
            <div className={`${styles.frostedSurface} ${styles.morphShell}`}
                    data-testid="idea-prompt-morph-shell"
                    data-confirming={Boolean(billingConfirmation)}
                    data-has-attachments={attachments.length > 0}>
                {billingConfirmation ? (
                    <div key="confirmation" role="group" aria-label={billingConfirmation.title}
                        className={styles.confirmationContent}
                        onKeyDown={event => { if (event.key === 'Escape') billingConfirmation.onCancel(); }}>
                        <span className={styles.srOnly}>{billingConfirmation.notice}</span>
                        <div className={styles.confirmationActions}>
                            <MagneticButton ref={confirmRef} data-dialogue-focus variant="primary" size="icon" className="rounded-full" onClick={billingConfirmation.onConfirm} aria-label={billingConfirmation.confirmLabel}><ChevronRight aria-hidden="true" className="size-5" /></MagneticButton>
                        </div>
                    </div>
                ) : (
                <fieldset key="composer"
                    className={styles.composerContent}
                    disabled={isTransitioning}
                    data-testid="idea-prompt-surface"
                    data-surface="conversation"
                >
                    {attachments.length > 0 && (
                        <div className={styles.attachments} data-testid="landing-attachments">
                            {attachments.map((attachment, index) => (
                                <div className={styles.attachment} key={`${attachment.filename || attachment.type}-${index}`}>
                                    {attachment.type === 'image'
                                        ? <img src={`data:${attachment.mediaType};base64,${attachment.data}`} alt={attachment.filename || 'image'} />
                                        : attachment.mediaType.startsWith('video/') ? <Video aria-hidden="true" /> : <FileText aria-hidden="true" />}
                                    <span>{attachment.filename}</span>
                                    <button type="button" aria-label={`Remove ${attachment.filename || 'attachment'}`}
                                        onClick={() => onAttachmentsChange(attachments.filter((_, itemIndex) => itemIndex !== index))}>
                                        <X aria-hidden="true" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <CommandBar value={value} onChange={onChange} inputRef={inputRef}
                        inputLabel={placeholder} placeholder={t('avatar.replyPlaceholder')}
                        sendLabel={generateLabel} attachLabel={t('intake.prompt.uploadAttachment')}
                        onAttach={() => fileRef.current?.click()} onFocusChange={onFocusChange}
                        disabled={isTransitioning} hasAttachments={attachments.length > 0} />
                    <input ref={fileRef} id="landing-attachment-upload" type="file" hidden disabled={isTransitioning}
                        accept={LANDING_ATTACHMENT_ACCEPT} multiple onChange={event => {
                            const files = Array.from(event.target.files || []);
                            event.target.value = '';
                            void addFiles(files);
                        }} />
                </fieldset>
                )}
            </div>
            {attachmentError && <p className={styles.error} role="alert">{attachmentError}</p>}
        </form>
    );
}
