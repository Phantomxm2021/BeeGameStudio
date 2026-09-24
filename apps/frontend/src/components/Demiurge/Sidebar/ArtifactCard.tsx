import React from 'react';
import { FileText, ChevronRight, BookOpen } from 'lucide-react';
import { artifactProcessor } from '../../../utils/artifactProcessor';

interface ArtifactCardProps {
    title?: string;
    sender: string;
    content: string;
    onPreview: () => void;
    agentColor?: string;
    artifactType?: string;
}

/**
 * ArtifactCard Component - Minimalist Redesign
 * 
 * Focuses on:
 * - Slim proportions and refined typography
 * - Removing bulky visual elements for a "premium" feel
 * - Fixing layout overlaps in the footer
 */
export const ArtifactCard: React.FC<ArtifactCardProps> = ({ 
    title, 
    sender, 
    content, 
    onPreview,
    agentColor = 'text-[var(--text-secondary)]',
    artifactType
}) => {
    // Extract metadata from content using the processor
    const { title: extractedTitle, summary } = artifactProcessor.extractMetadata(content);
    
    const displayTitle = title || extractedTitle || 'Document Artifact';
    const normalizedArtifactType = String(artifactType || '').trim().toUpperCase();
    const isGDD = normalizedArtifactType === 'GDD';

    return (
        <div
            className="group cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 transition-colors hover:bg-[var(--surface-hover)] focus-within:ring-2 focus-within:ring-[var(--ring)]"
            onClick={onPreview}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPreview();
                }
            }}
        >
            <div className="flex items-center gap-3">
                {/* Minimalist Icon Section */}
                <div className={`flex-shrink-0 ${agentColor.replace('bg-', 'text-')} opacity-80 group-hover:opacity-100 transition-opacity`}>
                    {isGDD ? <BookOpen className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                </div>

                {/* Content Section */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                    <h3 className="type-footnote truncate pr-4 text-[var(--text-primary)] transition-colors">
                            {displayTitle}
                        </h3>
                    </div>

                    <p className="type-footnote mb-2 line-clamp-1 text-[var(--text-secondary)]">
                        {summary}
                    </p>

                    {/* Footer Info - Decoupled to avoid overlaps */}
                    <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
                        <div className="type-caption-1 flex items-center text-[var(--text-muted)]">
                            <span className="truncate max-w-[80px]">{sender}</span>
                            <span className="mx-1.5 opacity-30">•</span>
                            <span className="whitespace-nowrap">{normalizedArtifactType || (isGDD ? 'GDD' : 'Artifact')}</span>
                        </div>
                        
                        <div className="type-footnote flex items-center text-[var(--text-secondary)]">
                            <span className="mr-1 hidden sm:inline">Open Preview</span>
                            <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

ArtifactCard.displayName = 'ArtifactCard';
