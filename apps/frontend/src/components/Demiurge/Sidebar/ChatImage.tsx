import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageGenerationHandle } from 'img-fx';
import { Expand, ImageOff, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../ui/dialog';
import './ChatImage.css';

const LazyImageGeneration = lazy(() => import('img-fx').then(({ ImageGeneration }) => ({ default: ImageGeneration })));

class ImageEffectBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() { return { failed: true }; }

    render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function OneShotImageReveal({ src, alt }: { src: string; alt: string }) {
    const effectRef = useRef<ImageGenerationHandle>(null);
    useEffect(() => {
        effectRef.current?.triggerReveal({ hold: 'manual' });
    }, [src]);
    return <LazyImageGeneration ref={effectRef} preset="pixels-organic" images={[src]} className="chat-image-effect">
        <span className="chat-image-effect-surface" role="img" aria-label={alt} />
    </LazyImageGeneration>;
}

/** One visual presentation for persisted tool images and Markdown images. */
export function ChatImage({ src, alt, pending = false, error = false, lang = 'en', animateReveal = false }: {
    src?: string; alt: string; pending?: boolean; error?: boolean; lang?: string; animateReveal?: boolean;
}) {
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [open, setOpen] = useState(false);
    const unavailable = error || failed || (!src && !pending);
    const loading = !unavailable && (pending || (!animateReveal && !loaded));
    const label = lang === 'zh' ? '放大图片' : 'Enlarge image';
    const image = src && !unavailable && !animateReveal ? <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-w-full object-contain"
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /> : null;
    return <span className="chat-image-card">
        <Dialog open={open} onOpenChange={setOpen}>
            <button type="button" className="chat-image-thumbnail" aria-label={`${label}: ${alt}`}
                disabled={!src || unavailable || loading} onClick={() => setOpen(true)} aria-busy={loading}
                data-loaded={!loading && !unavailable}>
                {loading && <span data-slot="skeleton" role="status" aria-label={lang === 'zh' ? '图片加载中' : 'Loading image'} className="chat-image-skeleton" />}
                {src && !unavailable && animateReveal ? <ImageEffectBoundary key={src} fallback={<img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-w-full object-contain" onError={() => setFailed(true)} />}>
                    <Suspense fallback={<span data-slot="skeleton" role="status" aria-label={lang === 'zh' ? '图片加载中' : 'Loading image'} className="chat-image-skeleton" />}>
                        <OneShotImageReveal src={src} alt={alt} />
                    </Suspense>
                </ImageEffectBoundary> : image}
                {unavailable && <span className="chat-image-error"><ImageOff size={24} />{lang === 'zh' ? '图片不可用' : 'Image unavailable'}</span>}
                {!loading && !unavailable && <span className="chat-image-expand" aria-hidden="true"><Expand size={13} /></span>}
            </button>
            <DialogContent className="chat-image-lightbox !max-w-[min(1120px,94vw)] !border-0 !bg-transparent !p-0 !shadow-none"
                backdropProps={{ className: '!bg-black/80 !backdrop-blur-sm' }}>
                <DialogTitle className="sr-only">{alt}</DialogTitle>
                <div className="chat-image-lightbox-bar">
                    <span>{lang === 'zh' ? '图片预览' : 'Image preview'}</span>
                    <DialogClose className="chat-image-lightbox-close" aria-label={lang === 'zh' ? '关闭预览' : 'Close preview'}><X size={17} /></DialogClose>
                </div>
                {src && <img src={src} alt={alt} referrerPolicy="no-referrer" className="chat-image-lightbox-image" />}
            </DialogContent>
        </Dialog>
    </span>;
}
