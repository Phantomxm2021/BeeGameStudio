import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { triggerReveal, effectFailure } = vi.hoisted(() => ({ triggerReveal: vi.fn(), effectFailure: { active: false } }));

vi.mock('img-fx', async () => {
    const React = await import('react');
    return {
        ImageGeneration: React.forwardRef(({ children, preset, images, autoReveal }: {
            children: React.ReactNode; preset: string; images: string[]; autoReveal?: boolean;
        }, ref) => {
            if (effectFailure.active) throw new Error('effect module failed');
            React.useImperativeHandle(ref, () => ({ triggerReveal }), []);
            return <div data-testid="image-generation-effect" data-preset={preset}
                data-images={images.join(',')} data-auto-reveal={String(Boolean(autoReveal))}>{children}</div>;
        }),
    };
});

import { ChatImage } from './ChatImage';

describe('ChatImage', () => {
    beforeEach(() => { triggerReveal.mockClear(); effectFailure.active = false; });

    it('reveals agent images once and keeps them visible without an auto-loop', async () => {
        const { rerender } = render(<ChatImage src="/generated.png" alt="image.png" animateReveal />);
        const effect = await screen.findByTestId('image-generation-effect');
        expect(effect).toHaveAttribute('data-preset', 'pixels-organic');
        expect(effect).toHaveAttribute('data-images', '/generated.png');
        expect(effect).toHaveAttribute('data-auto-reveal', 'false');
        await waitFor(() => expect(triggerReveal).toHaveBeenCalledExactlyOnceWith({ hold: 'manual' }));
        rerender(<ChatImage src="/generated.png" alt="image.png" animateReveal />);
        expect(triggerReveal).toHaveBeenCalledTimes(1);
        expect(effect.querySelector('img')).toBeNull();
        expect(document.querySelector('.chat-image-caption')).toBeNull();
        expect(screen.queryByText('image.png')).toBeNull();
    });

    it('reveals a replacement image once when the source changes', async () => {
        const { rerender } = render(<ChatImage src="/first.png" alt="First" animateReveal />);
        await waitFor(() => expect(triggerReveal).toHaveBeenCalledTimes(1));
        rerender(<ChatImage src="/second.png" alt="Second" animateReveal />);
        await waitFor(() => expect(triggerReveal).toHaveBeenCalledTimes(2));
        expect(await screen.findByTestId('image-generation-effect')).toHaveAttribute('data-images', '/second.png');
    });

    it('does not mount the WebGL effect for ordinary reference images', () => {
        render(<ChatImage src="/reference.png" alt="Reference" />);
        expect(screen.queryByTestId('image-generation-effect')).toBeNull();
    });

    it('shows the actual image when the optional effect fails', async () => {
        effectFailure.active = true;
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            render(<ChatImage src="/generated.png" alt="Generated" animateReveal />);
            expect(await screen.findByAltText('Generated')).toHaveAttribute('src', '/generated.png');
            expect(screen.queryByTestId('image-generation-effect')).toBeNull();
        } finally {
            errorLog.mockRestore();
        }
    });
});
