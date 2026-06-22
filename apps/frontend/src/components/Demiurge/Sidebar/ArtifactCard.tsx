import React from 'react';
import { motion } from 'framer-motion';
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
    agentColor = 'text-zinc-500', // Changed to text color for minimalist icon
    artifactType
}) => {
    // Extract metadata from content using the processor
    const { title: extractedTitle, summary } = artifactProcessor.extractMetadata(content);
    
    const displayTitle = title || extractedTitle || 'Document Artifact';
    const normalizedArtifactType = String(artifactType || '').trim().toUpperCase();
    const isGDD = normalizedArtifactType === 'GDD' || /GDD/i.test(displayTitle) || /游戏设计文档/i.test(content);

    return (
        <motion.div
            whileHover={{ y: -1 }}
            className="group cursor-pointer rounded-2xl border border-zinc-200/50 dark:border-zinc-700/50 bg-white/80 dark:bg-zinc-900/60 p-5 backdrop-blur-md transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800/80 hover:shadow-lg hover:shadow-zinc-200/20 dark:hover:shadow-none overflow-hidden"
            onClick={onPreview}
        >
            <div className="flex items-center gap-4">
                {/* Minimalist Icon Section */}
                <div className={`flex-shrink-0 ${agentColor.replace('bg-', 'text-')} opacity-80 group-hover:opacity-100 transition-opacity`}>
                    {isGDD ? <BookOpen className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                </div>

                {/* Content Section */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate pr-4 tracking-tight group-hover:text-black dark:group-hover:text-white transition-colors">
                            {displayTitle}
                        </h3>
                    </div>

                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1 opacity-70 mb-2">
                        {summary}
                    </p>

                    {/* Footer Info - Decoupled to avoid overlaps */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800/50">
                        <div className="flex items-center text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            <span className="truncate max-w-[80px]">{sender}</span>
                            <span className="mx-1.5 opacity-30">•</span>
                            <span className="whitespace-nowrap">{normalizedArtifactType || (isGDD ? 'GDD' : 'Artifact')}</span>
                        </div>
                        
                        <div className="flex items-center text-[10px] font-bold text-zinc-900 dark:text-zinc-200 opacity-40 group-hover:opacity-100 transition-all duration-300">
                            <span className="mr-1 hidden sm:inline">Open Preview</span>
                            <ChevronRight className="w-3 h-3 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100" />
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

ArtifactCard.displayName = 'ArtifactCard';
