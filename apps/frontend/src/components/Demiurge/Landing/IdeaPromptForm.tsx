import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, FileText, LayoutTemplate, Lightbulb, Loader2, Paperclip, Sparkles, Video, X } from 'lucide-react';
import type { ChatAttachmentPayload } from '../../../services/api';
import { filesToChatAttachments, isSupportedChatFile, MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_TOTAL_BYTES } from '../../../services/chatAttachments';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../../beui/registry/components/motion/popover-morph';
import styles from './IdeaPromptForm.module.css';

interface IdeaPromptFormProps {
    value: string;
    placeholder: string;
    generateLabel: string;
    isTransitioning: boolean;
    onChange: (value: string) => void;
    onSubmit: (event: React.FormEvent) => void;
    attachments: ChatAttachmentPayload[];
    onAttachmentsChange: (attachments: ChatAttachmentPayload[]) => void;
    creationMode: CreationMode;
    onCreationModeChange: (mode: CreationMode) => void;
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
    value, placeholder, generateLabel, isTransitioning, onChange, onSubmit,
    attachments, onAttachmentsChange, creationMode, onCreationModeChange, billingConfirmation,
}: IdeaPromptFormProps) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const keyboardSubmitRef = useRef(false);
    const wasConfirmingRef = useRef(false);
    const reducedMotion = useReducedMotion();
    const { t } = useTranslation('landing');
    const fileRef = useRef<HTMLInputElement>(null);
    const [attachmentError, setAttachmentError] = useState('');
    const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
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
        <form className={styles.form}
            onKeyDownCapture={() => { keyboardSubmitRef.current = true; }}
            onPointerDownCapture={() => { keyboardSubmitRef.current = false; }}
            onSubmit={event => {
            if (billingConfirmation || isTransitioning || (!value.trim() && attachments.length === 0)) {
                event.preventDefault();
                return;
            }
            onSubmit(event);
        }}>
            <motion.div className={`${styles.frostedSurface} ${styles.morphShell} shadow-raised`}
                    data-testid="idea-prompt-morph-shell"
                    data-confirming={Boolean(billingConfirmation)}
                    data-has-attachments={attachments.length > 0}
                    initial={false}
                    animate={{ width: billingConfirmation ? 'auto' : '100%' }}
                    transition={reducedMotion ? { duration: 0 } : { type: 'spring', duration: 0.45, bounce: 0.12 }}>
                {billingConfirmation ? (
                    <div className={styles.confirmationSizer} aria-hidden="true">
                        <span>{billingConfirmation.summary}</span>
                        <span className={styles.confirmationSizerButton}>{billingConfirmation.cancelLabel}</span>
                        <span className={styles.confirmationSizerButton}>{billingConfirmation.confirmLabel}</span>
                    </div>
                ) : null}
                <AnimatePresence mode="sync" initial={false}>
                {billingConfirmation ? (
                    <motion.div key="confirmation" role="group" aria-label={billingConfirmation.title}
                        className={styles.confirmationContent}
                        onKeyDown={event => { if (event.key === 'Escape') billingConfirmation.onCancel(); }}
                        initial={{ opacity: 0, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: reducedMotion ? 0 : 0.12 } }}
                        transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.23, 1, 0.32, 1] }}>
                        <span className={styles.confirmationSummary}>{billingConfirmation.summary}</span>
                        <span className={styles.srOnly}>{billingConfirmation.notice}</span>
                        <div className={styles.confirmationActions}>
                            <button type="button" className={styles.confirmationCancel} onClick={billingConfirmation.onCancel}>
                                {billingConfirmation.cancelLabel}
                            </button>
                            <button ref={confirmRef} type="button" className={styles.confirmationConfirm} onClick={billingConfirmation.onConfirm}>
                                {billingConfirmation.confirmLabel}
                            </button>
                        </div>
                    </motion.div>
                ) : (
                <motion.fieldset key="composer"
                    className={styles.composerContent}
                    disabled={isTransitioning}
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: reducedMotion ? 0 : 0.12 } }}
                    transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.23, 1, 0.32, 1] }}
                    data-testid="idea-prompt-surface"
                    data-surface="frosted-glass"
                    data-style-source="pixelfork"
                    data-glass-density="reinforced"
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
                    <div className={styles.inputRow}>
                        <button className={styles.uploadButton} type="button" aria-label={t('intake.prompt.uploadAttachment')}
                            title={t('intake.prompt.uploadAttachment')} onClick={() => fileRef.current?.click()}>
                            <Paperclip aria-hidden="true" />
                        </button>
                        <textarea ref={inputRef} className={styles.input} aria-label={placeholder}
                            placeholder={placeholder} rows={1} value={value}
                            onChange={event => onChange(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    event.currentTarget.form?.requestSubmit();
                                }
                            }} />
                        <MorphPopover open={isModeMenuOpen} onOpenChange={setIsModeMenuOpen}>
                            <MorphPopoverTrigger>
                                <button type="button" className={styles.modeButton} aria-label={t(creationMode === 'creative' ? 'intake.prompt.creativeMode' : 'intake.prompt.blueprintMode')}>
                                    {creationMode === 'creative' ? <Lightbulb aria-hidden="true" /> : <LayoutTemplate aria-hidden="true" />}
                                    <span>{t(creationMode === 'creative' ? 'intake.prompt.creativeMode' : 'intake.prompt.blueprintMode')}</span>
                                    <ChevronDown className={styles.modeChevron} aria-hidden="true" />
                                </button>
                            </MorphPopoverTrigger>
                            <MorphPopoverContent side="top" align="end" sideOffset={8} radius={16} className={styles.popoverMenu}>
                                <button type="button" className={styles.popoverItem} onClick={() => { onCreationModeChange('creative'); setIsModeMenuOpen(false); }}>
                                    <Lightbulb />{t('intake.prompt.creativeMode')}{creationMode === 'creative' ? <Check className={styles.selectedIcon} /> : null}
                                </button>
                                <button type="button" className={styles.popoverItem} onClick={() => { onCreationModeChange('blueprint'); setIsModeMenuOpen(false); }}>
                                    <LayoutTemplate />{t('intake.prompt.blueprintMode')}{creationMode === 'blueprint' ? <Check className={styles.selectedIcon} /> : null}
                                </button>
                            </MorphPopoverContent>
                        </MorphPopover>
                        <button className={styles.submitButton} type="submit" aria-label={generateLabel}
                            title={generateLabel} disabled={isTransitioning || (!value.trim() && !attachments.length)}>
                            {isTransitioning ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                        </button>
                    </div>
                    <input ref={fileRef} id="landing-attachment-upload" type="file" hidden disabled={isTransitioning}
                        accept={LANDING_ATTACHMENT_ACCEPT} multiple onChange={event => {
                            const files = Array.from(event.target.files || []);
                            event.target.value = '';
                            void addFiles(files);
                        }} />
                </motion.fieldset>
                )}
                </AnimatePresence>
            </motion.div>
            {attachmentError && <p className={styles.error} role="alert">{attachmentError}</p>}
        </form>
    );
}
