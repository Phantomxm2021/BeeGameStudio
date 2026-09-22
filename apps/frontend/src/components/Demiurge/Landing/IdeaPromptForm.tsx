import { useRef, useState } from 'react';
import { BorderBeam } from 'border-beam';
import { ArrowRight, Check, ChevronDown, CircleHelp, FileText, Image as ImageIcon, LayoutTemplate, Lightbulb, Loader2, Plus, Send, Video, X } from 'lucide-react';
import type { ChatAttachmentPayload } from '../../../services/api';
import { filesToChatAttachments, isSupportedChatFile, MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_TOTAL_BYTES } from '../../../services/chatAttachments';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../../beui/registry/components/motion/popover-morph';
import styles from './IdeaPromptForm.module.css';

interface IdeaPromptFormProps {
    value: string;
    placeholder: string;
    generateLabel: string;
    isTransitioning: boolean;
    isThinking: boolean;
    onChange: (value: string) => void;
    onSubmit: (event: React.FormEvent) => void;
    attachments: ChatAttachmentPayload[];
    onAttachmentsChange: (attachments: ChatAttachmentPayload[]) => void;
    creationMode: CreationMode;
    onCreationModeChange: (mode: CreationMode) => void;
}

const DOCUMENT_ATTACHMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.xlsx,.json,.jsonl';
const IMAGE_ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
const VIDEO_ATTACHMENT_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm';
export type CreationMode = 'creative' | 'blueprint';
type OpenMenu = 'attachments' | 'mode' | null;

export function IdeaPromptForm({
    value, placeholder, generateLabel, isTransitioning, onChange, onSubmit,
    isThinking, attachments, onAttachmentsChange, creationMode, onCreationModeChange,
}: IdeaPromptFormProps) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [attachmentError, setAttachmentError] = useState('');
    const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
    const openAttachmentPicker = (accept: string) => {
        if (!fileRef.current) return;
        fileRef.current.accept = accept;
        fileRef.current.click();
    };
    const addFiles = async (files: File[]) => {
        setAttachmentError('');
        try {
            if (files.some(file => !isSupportedChatFile(file) || /\.(doc|xls)$/i.test(file.name))) {
                setAttachmentError('Unsupported reference or file over 10 MB. Use PDF, DOCX, XLSX, text, PNG/JPEG/WebP or MP4/MOV/WebM.');
                return;
            }
            if (attachments.length + files.length > MAX_CHAT_ATTACHMENTS ||
                files.reduce((size, file) => size + file.size, 0) + attachments.reduce((size, file) => size + Math.floor(file.data.length * 3 / 4), 0) > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
                setAttachmentError('最多 8 个附件，总大小不超过 32 MB。');
                return;
            }
            const added = await filesToChatAttachments(files);
            const next = [...attachments, ...added];
            if (added.length) onAttachmentsChange(next);
            else if (files.length) setAttachmentError('Unsupported file type or file too large.');
        } catch {
            setAttachmentError('Could not read the attachment. Please try again.');
        }
    };

    return (
        <form className={styles.form} onSubmit={event => {
            if (isTransitioning || (!value.trim() && attachments.length === 0)) {
                event.preventDefault();
                return;
            }
            onSubmit(event);
        }}>
            <BorderBeam
                className={styles.beamPreview}
                data-testid="idea-prompt-beam"
                size="pulse-outside"
                colorVariant="sunset"
                theme="light"
                strength={0.7}
                duration={2.8}
                brightness={1.5}
                saturation={0.9}
                borderRadius={30}
                active={isThinking}
            >
                <fieldset className={styles.root} disabled={isTransitioning} data-testid="idea-prompt-surface">
                <div className={styles.surface}>
                <div className={styles.inputPanel}>
                    {attachments.length > 0 && (
                        <div className={styles.attachments} data-testid="landing-attachments">
                            {attachments.map((attachment, index) => (
                                <div className={styles.attachment} key={`${attachment.filename}-${index}`}>
                                    {attachment.type === 'image'
                                        ? <img src={`data:${attachment.mediaType};base64,${attachment.data}`} alt={attachment.filename || 'Image'} />
                                        : attachment.mediaType.startsWith('video/') ? <Video aria-hidden="true" /> : <FileText aria-hidden="true" />}
                                    <span>{attachment.filename}</span>
                                    <button type="button" aria-label={`Remove ${attachment.filename || 'attachment'}`}
                                        onClick={() => onAttachmentsChange(attachments.filter((_, i) => i !== index))}>
                                        <X aria-hidden="true" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <textarea ref={inputRef} className={styles.input} aria-label={placeholder}
                        placeholder="Ask anything..." rows={2} value={value}
                        onChange={event => onChange(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                            }
                        }} />
                    <div className={styles.inputActions}>
                        <MorphPopover open={openMenu === 'attachments'} onOpenChange={open => setOpenMenu(open ? 'attachments' : null)}>
                            <MorphPopoverTrigger>
                                <button className={styles.addButton} type="button" disabled={isTransitioning} aria-label="添加附件" title="添加附件">
                                    <Plus aria-hidden="true" />
                                </button>
                            </MorphPopoverTrigger>
                            <MorphPopoverContent side="top" align="start" sideOffset={8} radius={16} className={styles.popoverMenu}>
                                <button type="button" className={styles.popoverItem} onClick={() => { setOpenMenu(null); openAttachmentPicker(DOCUMENT_ATTACHMENT_ACCEPT); }}><FileText />文档</button>
                                <button type="button" className={styles.popoverItem} onClick={() => { setOpenMenu(null); openAttachmentPicker(IMAGE_ATTACHMENT_ACCEPT); }}><ImageIcon />图片</button>
                                <button type="button" className={styles.popoverItem} onClick={() => { setOpenMenu(null); openAttachmentPicker(VIDEO_ATTACHMENT_ACCEPT); }}><Video />视频</button>
                            </MorphPopoverContent>
                        </MorphPopover>
                        <button className={styles.submitButton} type="submit" aria-label={generateLabel}
                            title={generateLabel} disabled={isTransitioning || (!value.trim() && !attachments.length)}>
                            {isTransitioning ? <Loader2 className={styles.spinner} aria-hidden="true" /> : <Send aria-hidden="true" />}
                        </button>
                    </div>
                </div>
                <div className={styles.toolbar}>
                    <div className={styles.toolGroup}>
                        <MorphPopover open={openMenu === 'mode'} onOpenChange={open => setOpenMenu(open ? 'mode' : null)}>
                            <MorphPopoverTrigger>
                                <button type="button" className={styles.modeButton} disabled={isTransitioning}>
                                    {creationMode === 'creative' ? <Lightbulb aria-hidden="true" /> : <LayoutTemplate aria-hidden="true" />}
                                    <span>{creationMode === 'creative' ? '创意模式' : '蓝图模式'}</span>
                                    <ChevronDown className={styles.modeChevron} aria-hidden="true" />
                                </button>
                            </MorphPopoverTrigger>
                            <MorphPopoverContent side="top" align="start" sideOffset={8} radius={16} className={styles.popoverMenu}>
                                    <button type="button" className={styles.popoverItem} onClick={() => { onCreationModeChange('creative'); setOpenMenu(null); }}>
                                    <Lightbulb />创意模式{creationMode === 'creative' ? <Check className={styles.selectedIcon} /> : null}
                                </button>
                                <button type="button" className={styles.popoverItem} onClick={() => { onCreationModeChange('blueprint'); setOpenMenu(null); }}>
                                    <LayoutTemplate />蓝图模式{creationMode === 'blueprint' ? <Check className={styles.selectedIcon} /> : null}
                                </button>
                            </MorphPopoverContent>
                        </MorphPopover>
                    </div>
                    <a className={styles.learnButton} href="#examples-tutorials" aria-label="Learn more">
                        <CircleHelp aria-hidden="true" /><span>Learn more</span><ArrowRight aria-hidden="true" />
                    </a>
                </div>
                </div>
                <input ref={fileRef} id="landing-attachment-upload" type="file" hidden
                    accept={[DOCUMENT_ATTACHMENT_ACCEPT, IMAGE_ATTACHMENT_ACCEPT, VIDEO_ATTACHMENT_ACCEPT].join(',')} multiple onChange={event => {
                        const files = Array.from(event.target.files || []);
                        event.target.value = '';
                        void addFiles(files);
                    }} />
                </fieldset>
            </BorderBeam>
            {attachmentError && <p className={styles.error} role="alert">{attachmentError}</p>}
        </form>
    );
}
