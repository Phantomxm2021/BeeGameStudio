import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Liquid } from 'liquid-gooey';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, FileText, LayoutTemplate, Lightbulb, Loader2, Paperclip, Video, X } from 'lucide-react';
import type { ChatAttachmentPayload } from '../../../services/api';
import { filesToChatAttachments, isSupportedChatFile, MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_TOTAL_BYTES } from '../../../services/chatAttachments';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../../beui/registry/components/motion/popover-morph';
import { ArrowUpIcon, type ArrowUpIconHandle } from '../../ui/icons/arrow-up';
import styles from './ClassicIdeaPromptForm.module.css';

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

// Bencho Command bar (MIT): one shared surface stretches into a neck.
// The bar stays anchored; only the action travels. Use the reference
// offset and overshoot so the short liquid neck snaps apart naturally.
const SEND_TUCK = 40 + 8;
const SEND_MORPH = { duration: 520, ease: 'cubic-bezier(0.22, 1.3, 0.71, 1)' } as const;

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

export function ClassicIdeaPromptForm({
    value, placeholder, generateLabel, isTransitioning, onChange, onSubmit,
    attachments, onAttachmentsChange, creationMode, onCreationModeChange, billingConfirmation,
}: IdeaPromptFormProps) {
    const surfaceId = useId();
    const rimId = `prompt-rim-${surfaceId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const liquidRef = useRef<HTMLDivElement>(null);
    const rimRef = useRef<SVGUseElement>(null);
    const confirmationSizerRef = useRef<HTMLDivElement>(null);
    const arrowRef = useRef<ArrowUpIconHandle>(null);
    useLayoutEffect(() => {
        const group = liquidRef.current;
        const mask = group?.querySelector<SVGMaskElement>('[data-gooey-overlay] mask');
        // Reuse liquid-gooey 0.2.1's live merged silhouette rather than
        // duplicating its motion. The mask clips a real HTML backdrop layer.
        if (group && mask) group.style.setProperty('--composer-mask', `url("#${mask.id}")`);
        const silhouette = mask?.querySelector('use')?.getAttribute('href');
        if (silhouette) rimRef.current?.setAttribute('href', silhouette);
    }, []);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const keyboardSubmitRef = useRef(false);
    const wasConfirmingRef = useRef(false);
    const reducedMotion = useReducedMotion();
    const isConfirming = Boolean(billingConfirmation);
    useLayoutEffect(() => {
        const group = liquidRef.current;
        const sizer = confirmationSizerRef.current;
        if (!group || !sizer) return;
        // Animate between real lengths, never width:auto or a scaled text layer.
        // Measure translated copy and track font/viewport changes.
        const measure = () => group.style.setProperty('--confirmation-width', `${Math.ceil(sizer.getBoundingClientRect().width) + 2}px`);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(sizer);
        return () => observer.disconnect();
    }, [isConfirming]);
    const hasContent = Boolean(value.trim() || attachments.length);
    const [sendOpen, setSendOpen] = useState(false);
    // Disabling the field during the access check blurs it. Keep the busy action
    // in place until consent starts, instead of flashing the mode picker back in.
    const sendDetached = (sendOpen || isTransitioning) && !billingConfirmation;
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
            onBlurCapture={event => {
                // Keep the action open when focus moves from input to Send;
                // collapsing on textarea blur would swallow mouse/keyboard submission.
                if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) setSendOpen(false);
            }}
            onKeyDownCapture={() => { keyboardSubmitRef.current = true; }}
            onPointerDownCapture={() => { keyboardSubmitRef.current = false; }}
            onSubmit={event => {
            if (billingConfirmation || isTransitioning || (!value.trim() && attachments.length === 0)) {
                event.preventDefault();
                return;
            }
            onSubmit(event);
        }}>
            <Liquid ref={liquidRef} className={styles.liquidGroup} blur={reducedMotion ? 0 : 3} contrast={22}
                fill="var(--background)" filterPadding={60}
                data-testid="idea-prompt-liquid" data-send-detached={sendDetached} data-confirming={isConfirming}>
            {/* Morph positions the button and its silhouette together. The bar never moves. */}
            <Liquid.Item className={styles.barSlot}>
            <motion.div className={`${styles.frostedSurface} ${styles.morphShell}`}
                    data-testid="idea-prompt-morph-shell"
                    data-confirming={Boolean(billingConfirmation)}
                    data-has-attachments={attachments.length > 0}
                    initial={false}>
                {billingConfirmation ? (
                    <div ref={confirmationSizerRef} className={styles.confirmationSizer} aria-hidden="true">
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
                        transition={{ duration: reducedMotion ? 0 : 0.22, delay: reducedMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}>
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
                            <Paperclip aria-hidden="true" strokeWidth={1.75} />
                        </button>
                        <textarea ref={inputRef} className={styles.input} aria-label={placeholder}
                            placeholder={placeholder} rows={1} wrap="off" value={value}
                            onFocus={() => setSendOpen(true)}
                            onChange={event => onChange(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    event.currentTarget.form?.requestSubmit();
                                }
                            }} />
                        <MorphPopover open={isModeMenuOpen} onOpenChange={setIsModeMenuOpen}>
                            <MorphPopoverTrigger>
                                <button type="button" className={styles.modeButton}
                                    data-hidden={sendDetached} aria-hidden={sendDetached} tabIndex={sendDetached ? -1 : 0}
                                    aria-label={t(creationMode === 'creative' ? 'intake.prompt.creativeMode' : 'intake.prompt.blueprintMode')}>
                                    {creationMode === 'creative' ? <Lightbulb aria-hidden="true" /> : <LayoutTemplate aria-hidden="true" />}
                                    <span>{t(creationMode === 'creative' ? 'intake.prompt.creativeMode' : 'intake.prompt.blueprintMode')}</span>
                                    <ChevronDown className={styles.modeChevron} aria-hidden="true" />
                                </button>
                            </MorphPopoverTrigger>
                            <MorphPopoverContent side="bottom" align="end" sideOffset={16} radius={16} className={styles.popoverMenu}>
                                <button type="button" className={styles.popoverItem} aria-pressed={creationMode === 'creative'} onClick={() => { onCreationModeChange('creative'); setIsModeMenuOpen(false); }}>
                                    <Lightbulb aria-hidden="true" /><span>{t('intake.prompt.creativeMode')}</span><Check aria-hidden="true" className={styles.selectedIcon} data-selected={creationMode === 'creative'} />
                                </button>
                                <button type="button" className={styles.popoverItem} aria-pressed={creationMode === 'blueprint'} onClick={() => { onCreationModeChange('blueprint'); setIsModeMenuOpen(false); }}>
                                    <LayoutTemplate aria-hidden="true" /><span>{t('intake.prompt.blueprintMode')}</span><Check aria-hidden="true" className={styles.selectedIcon} data-selected={creationMode === 'blueprint'} />
                                </button>
                            </MorphPopoverContent>
                        </MorphPopover>

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
            </Liquid.Item>
            <Liquid.Item className={styles.sendSlot} x={sendDetached ? 0 : -SEND_TUCK} radius={23}
                transition={reducedMotion ? { duration: 0 } : SEND_MORPH}>
                <button className={styles.submitButton} type="submit" aria-label={generateLabel}
                    data-testid="idea-prompt-send" data-detached={sendDetached}
                    aria-hidden={!sendDetached} tabIndex={sendDetached && hasContent ? 0 : -1}
                    onMouseEnter={() => { if (!reducedMotion) arrowRef.current?.startAnimation(); }}
                    onMouseLeave={() => arrowRef.current?.stopAnimation()}
                    onFocus={() => { if (!reducedMotion) arrowRef.current?.startAnimation(); }}
                    onBlur={() => arrowRef.current?.stopAnimation()}
                    title={generateLabel} disabled={isTransitioning || !hasContent || Boolean(billingConfirmation)}>
                    {isTransitioning ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <ArrowUpIcon ref={arrowRef} size={20} className={styles.sendIcon} aria-hidden="true" />}
                </button>
            </Liquid.Item>
            {/* A 1px inner edge follows the same live silhouette as the glass.
                Separate pill borders would cut across the neck during the split. */}
            <svg className={styles.liquidRim} aria-hidden="true" focusable="false">
                <defs>
                    <filter id={rimId} colorInterpolationFilters="sRGB">
                        <feMorphology in="SourceAlpha" operator="erode" radius="1" result="inside" />
                        <feComposite in="SourceAlpha" in2="inside" operator="out" result="edge" />
                        <feFlood floodColor="var(--foreground)" floodOpacity="0.12" result="ink" />
                        <feComposite in="ink" in2="edge" operator="in" />
                    </filter>
                </defs>
                <use ref={rimRef} filter={`url(#${rimId})`} />
            </svg>
            </Liquid>
            {attachmentError && <p className={styles.error} role="alert">{attachmentError}</p>}
        </form>
    );
}
