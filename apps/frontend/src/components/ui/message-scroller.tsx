import {
    MessageScroller as BaseMessageScroller,
    useMessageScroller,
    useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller';
import { ArrowDown } from 'lucide-react';
import { useRef, useState, type ComponentProps } from 'react';

const cx = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(' ');

type MessageScrollerProps = ComponentProps<typeof BaseMessageScroller.Root>;
type MessageScrollerViewportProps = ComponentProps<typeof BaseMessageScroller.Viewport>;
type MessageScrollerContentProps = ComponentProps<typeof BaseMessageScroller.Content>;
type MessageScrollerItemProps = ComponentProps<typeof BaseMessageScroller.Item>;
type MessageScrollerButtonProps = ComponentProps<typeof BaseMessageScroller.Button>;

type MessageScrollerOutlineItem = {
    id: string;
    label: string;
};

type MessageScrollerOutlineProps = {
    items: MessageScrollerOutlineItem[];
    className?: string;
};

export const MessageScrollerProvider = BaseMessageScroller.Provider;
export { useMessageScroller, useMessageScrollerVisibility };

export function MessageScroller({ className, ...props }: MessageScrollerProps) {
    return (
        <BaseMessageScroller.Root
            className={cx('relative flex min-h-0 flex-1 flex-col', className)}
            {...props}
        />
    );
}

export function MessageScrollerViewport({ className, ...props }: MessageScrollerViewportProps) {
    return (
        <BaseMessageScroller.Viewport
            className={cx(
                'scroll-fade scroll-fade-y scrollbar-premium relative min-h-0 flex-1 overscroll-contain overflow-y-auto scroll-smooth px-4 pt-4 pb-4',
                className,
            )}
            {...props}
        />
    );
}

export function MessageScrollerContent({ className, ...props }: MessageScrollerContentProps) {
    return (
        <BaseMessageScroller.Content
            className={cx('relative min-h-full', className)}
            {...props}
        />
    );
}

export function MessageScrollerItem(props: MessageScrollerItemProps) {
    return <BaseMessageScroller.Item {...props} />;
}

export function MessageScrollerButton({ className, ...props }: MessageScrollerButtonProps) {
    return (
        <BaseMessageScroller.Button
            aria-label="Scroll to end"
            className={cx(
                'absolute bottom-4 left-1/2 z-30 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-white/10 bg-zinc-950/80 text-zinc-200 shadow-lg backdrop-blur-xl transition-all hover:bg-zinc-900 hover:text-white data-[active=false]:pointer-events-none data-[active=false]:opacity-0',
                className,
            )}
            {...props}
        >
            <ArrowDown className="h-5 w-5" aria-hidden="true" />
        </BaseMessageScroller.Button>
    );
}

export function MessageScrollerOutline({ items, className }: MessageScrollerOutlineProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [hoveredTop, setHoveredTop] = useState(0);
    const outlineRef = useRef<HTMLDivElement | null>(null);
    const hoveredElementRef = useRef<HTMLElement | null>(null);
    const { scrollToMessage } = useMessageScroller();
    const { currentAnchorId, visibleMessageIds } = useMessageScrollerVisibility();

    if (items.length === 0) return null;

    const visibleIds = new Set(visibleMessageIds);
    const hoveredIndex = items.findIndex((item) => item.id === hoveredId);
    const hoveredItem = hoveredIndex >= 0 ? items[hoveredIndex] : null;

    const updateHoveredPosition = (element: HTMLElement | null) => {
        const outline = outlineRef.current;
        if (!outline || !element) return;
        const outlineRect = outline.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        setHoveredTop(elementRect.top - outlineRect.top + elementRect.height / 2);
    };

    const clearHoveredItem = () => {
        hoveredElementRef.current = null;
        setHoveredId(null);
    };

    return (
        <div
            ref={outlineRef}
            data-testid="message-scroller-outline"
            className={cx('absolute left-4 top-1/2 z-30 -translate-y-1/2', className)}
            onMouseLeave={clearHoveredItem}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) clearHoveredItem();
            }}
        >
            <div
                role="navigation"
                aria-label="Transcript outline"
                onScroll={() => updateHoveredPosition(hoveredElementRef.current)}
                className="flex max-h-72 w-10 flex-col items-start justify-center gap-1 overflow-y-auto overscroll-contain py-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                style={{
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 14%, black 86%, transparent 100%)',
                    maskImage: 'linear-gradient(to bottom, transparent 0, black 14%, black 86%, transparent 100%)',
                }}
            >
                {items.map((item, index) => {
                    const isCurrent = currentAnchorId === item.id || (!currentAnchorId && visibleMessageIds[0] === item.id);
                    const isVisible = visibleIds.has(item.id);
                    const presentation = getOutlineLinePresentation(index, hoveredIndex, isCurrent, isVisible);
                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-label={`Jump to message ${index + 1}`}
                            aria-current={isCurrent ? 'location' : undefined}
                            data-testid="message-scroller-outline-line"
                            data-active={isCurrent ? 'true' : 'false'}
                            data-length={presentation.length}
                            data-cascade={presentation.cascade}
                            onMouseEnter={(event) => {
                                hoveredElementRef.current = event.currentTarget;
                                setHoveredId(item.id);
                                updateHoveredPosition(event.currentTarget);
                            }}
                            onFocus={(event) => {
                                hoveredElementRef.current = event.currentTarget;
                                setHoveredId(item.id);
                                updateHoveredPosition(event.currentTarget);
                            }}
                            onClick={() => scrollToMessage(item.id, { align: 'start', behavior: 'smooth' })}
                            title={item.label}
                            className="group flex h-3 w-10 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                        >
                            <span
                                className={cx(
                                    'block h-1 rounded-full transition-[width,background-color,box-shadow] duration-200',
                                    presentation.widthClassName,
                                    presentation.colorClassName,
                                )}
                                aria-hidden="true"
                            />
                        </button>
                    );
                })}
            </div>
            {hoveredItem ? (
                <div
                    role="tooltip"
                    data-testid="message-scroller-outline-card"
                    style={{ top: `${hoveredTop}px` }}
                    className="pointer-events-none absolute left-11 top-1/2 w-64 -translate-y-1/2 rounded-2xl border border-white/10 bg-zinc-900/90 px-3.5 py-2.5 text-zinc-100 shadow-2xl shadow-black/35 backdrop-blur-2xl"
                >
                    <div className="type-callout line-clamp-2 text-zinc-50">{hoveredItem.label}</div>
                </div>
            ) : null}
        </div>
    );
}

const getOutlineLinePresentation = (
    index: number,
    hoveredIndex: number,
    isCurrent: boolean,
    isVisible: boolean,
): {
    cascade: string;
    length: 'short' | 'near-3' | 'near-2' | 'near-1' | 'full';
    widthClassName: string;
    colorClassName: string;
} => {
    if (hoveredIndex >= 0) {
        const distance = Math.abs(index - hoveredIndex);
        if (distance <= 3) {
            const widthByDistance = ['w-9', 'w-7', 'w-5', 'w-3'] as const;
            const lengthByDistance = ['full', 'near-1', 'near-2', 'near-3'] as const;
            return {
                cascade: String(distance),
                length: lengthByDistance[distance],
                widthClassName: widthByDistance[distance],
                colorClassName: distance === 0
                    ? 'bg-zinc-100 shadow-[0_0_14px_rgba(255,255,255,0.35)]'
                    : 'bg-emerald-300/70 shadow-[0_0_10px_rgba(110,231,183,0.16)]',
            };
        }
    }

    return {
        cascade: '',
        length: 'short',
        widthClassName: 'w-3',
        colorClassName: isCurrent
            ? 'bg-emerald-300/90 shadow-[0_0_12px_rgba(110,231,183,0.24)]'
            : isVisible
                ? 'bg-emerald-300/45'
                : 'bg-zinc-600/70',
    };
};
