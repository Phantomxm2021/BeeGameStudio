import { useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../ui/dialog';
import './ChatImage.css';

/** One visual presentation for persisted tool images and Markdown images. */
export function ChatImage({ src, alt, pending = false, error = false, lang = 'en' }: {
    src?: string; alt: string; pending?: boolean; error?: boolean; lang?: string;
}) {
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [open, setOpen] = useState(false);
    const unavailable = error || failed || (!src && !pending);
    const loading = !unavailable && (pending || !loaded);
    const label = lang === 'zh' ? '放大图片' : 'Enlarge image';
    return <span className="chat-image-card">
        <Dialog open={open} onOpenChange={setOpen}>
            <button type="button" className="chat-image-thumbnail" aria-label={`${label}: ${alt}`}
                disabled={!src || unavailable || loading} onClick={() => setOpen(true)} aria-busy={loading}>
                {loading && <span data-slot="skeleton" role="status" aria-label={lang === 'zh' ? '图片加载中' : 'Loading image'} className="chat-image-skeleton" />}
                {src && !unavailable && <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-w-full object-contain"
                    onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
                {unavailable && <span className="chat-image-error"><ImageOff size={24} />{lang === 'zh' ? '图片不可用' : 'Image unavailable'}</span>}
            </button>
            <span className="chat-image-caption" title={alt}>{alt}</span>
            <DialogContent className="!max-w-[min(1100px,94vw)] !p-3">
                <DialogTitle className="pr-10 !text-sm">{alt}</DialogTitle>
                <DialogClose className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-border bg-background/90 p-1 text-foreground shadow-sm hover:bg-accent" aria-label={lang === 'zh' ? '关闭预览' : 'Close preview'}><X size={16} /></DialogClose>
                {src && <img src={src} alt={alt} referrerPolicy="no-referrer" className="mt-3 max-h-[80dvh] w-full object-contain" />}
            </DialogContent>
        </Dialog>
    </span>;
}
