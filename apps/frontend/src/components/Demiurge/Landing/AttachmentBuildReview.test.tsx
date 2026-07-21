import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AttachmentBuildReview } from './AttachmentBuildReview';
import type { AttachmentBuildAnalysis } from '../../../services/attachmentBuild';

const analysis: AttachmentBuildAnalysis = {
    analysisId: 'analysis_review',
    sourceType: 'mixed',
    completeness: 'partial',
    confirmedFacts: [{ field: 'coreLoop', value: 'Solve puzzles', source: 'game-design.md' }],
    inferredDesign: [{ field: 'camera', value: 'Top-down', confidence: 'medium', source: 'concept.png' }],
    missingFields: [{ field: 'winCondition', reason: 'Not specified' }],
    conflicts: [{ field: 'style', gddValue: 'Pixel', imageValue: 'Realistic', resolution: 'needs_user_choice' }],
    gddDraft: '# Game Design',
};

describe('AttachmentBuildReview', () => {
    it('renders structured facts, inferences, missing fields, and conflicts', () => {
        render(
            <AttachmentBuildReview
                analysis={analysis}
                isSubmitting={false}
                onChangeDraft={vi.fn()}
                onSelectConflict={vi.fn()}
                onRetry={vi.fn()}
                onConfirm={vi.fn()}
                resourceLibraryUsage="preferred"
                onResourceLibraryUsageChange={vi.fn()}
            />
        );

        expect(screen.getByTestId('attachment-build-review')).toBeInTheDocument();
        expect(screen.getByText(/Solve puzzles/)).toBeInTheDocument();
        expect(screen.getByText(/Top-down/)).toBeInTheDocument();
        expect(screen.getByText(/winCondition: Not specified/)).toBeInTheDocument();
        expect(screen.getByText(/Pixel/)).toBeInTheDocument();
        expect(screen.getByText(/Realistic/)).toBeInTheDocument();
    });

    it('emits draft edits, conflict choices, retry, and one confirmation', () => {
        const onChangeDraft = vi.fn();
        const onSelectConflict = vi.fn();
        const onRetry = vi.fn();
        const onConfirm = vi.fn();
        const onResourceLibraryUsageChange = vi.fn();
        render(
            <AttachmentBuildReview
                analysis={analysis}
                isSubmitting={false}
                onChangeDraft={onChangeDraft}
                onSelectConflict={onSelectConflict}
                onRetry={onRetry}
                onConfirm={onConfirm}
                resourceLibraryUsage="preferred"
                onResourceLibraryUsageChange={onResourceLibraryUsageChange}
            />
        );

        fireEvent.change(screen.getByLabelText('Confirmed GDD'), { target: { value: '# Edited GDD' } });
        fireEvent.click(screen.getByRole('button', { name: 'Use GDD value' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Resource Library usage' }), { target: { value: 'required' } });
        fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm and build' }));

        expect(onChangeDraft).toHaveBeenCalledWith('# Edited GDD');
        expect(onSelectConflict).toHaveBeenCalledWith('style', 'gdd');
        expect(onResourceLibraryUsageChange).toHaveBeenCalledWith('required');
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
