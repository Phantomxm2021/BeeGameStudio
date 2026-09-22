import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserQuestionPanel } from './UserQuestionPanel';

const input = { questions: [
    { question: 'Which style?', header: 'Style', options: [
        { label: 'Pixel', description: 'Pixel art' }, { label: 'Vector', description: 'Vector art' },
    ], multiSelect: false },
    { question: 'Which features?', header: 'Features', options: [
        { label: 'Jump', description: 'Jumping' }, { label: 'Run', description: 'Running' },
    ], multiSelect: true },
] };

describe('native user questions with BeUI ApprovalCard', () => {
    it('submits original question keys, option labels and custom answers', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<UserQuestionPanel input={input} lang="en" busy={false} onSubmit={onSubmit} />);
        fireEvent.click(screen.getByRole('radio', { name: /Pixel/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
        const jump = await screen.findByRole('checkbox', { name: /Jump/ });
        fireEvent.click(jump);
        fireEvent.click(screen.getByRole('checkbox', { name: /Run/ }));
        fireEvent.change(screen.getByPlaceholderText('Or enter your own answer…'), { target: { value: 'Swim' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
        expect(onSubmit).toHaveBeenCalledWith({ 'Which style?': 'Pixel', 'Which features?': 'Jump, Run, Swim' });
    });

    it('keeps free text after submission failure, disables while busy and allows decline', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        const onDismiss = vi.fn().mockResolvedValue(undefined);
        const props = { input: { questions: input.questions.slice(0, 1) }, lang: 'zh' as const, busy: false, onSubmit, onDismiss };
        const { rerender } = render(<UserQuestionPanel {...props} />);
        expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled();
        fireEvent.change(screen.getByPlaceholderText('或输入你自己的回答…'), { target: { value: '水彩' } });
        rerender(<UserQuestionPanel {...props} busy />);
        expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '暂不回答' })).toBeDisabled();
        rerender(<UserQuestionPanel {...props} error="Network failed" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Network failed');
        expect(screen.getByPlaceholderText('或输入你自己的回答…')).toHaveValue('水彩');
        fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ 'Which style?': '水彩' }));
        fireEvent.click(screen.getByRole('button', { name: '暂不回答' }));
        expect(onDismiss).toHaveBeenCalledOnce();
    });
});
