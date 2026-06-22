/**
 * ArtifactProcessor Utility
 * 
 * Responsible for processing artifact content, such as stripping internal markers
 * that should not be visible to the end user.
 * 
 * Design Pattern: Singleton
 */
export class ArtifactProcessor {
    private static instance: ArtifactProcessor;

    private constructor() {}

    public static getInstance(): ArtifactProcessor {
        if (!ArtifactProcessor.instance) {
            ArtifactProcessor.instance = new ArtifactProcessor();
        }
        return ArtifactProcessor.instance;
    }

    /**
     * Strips HTML comment markers (<!-- xxx -->) from the content.
     * These markers are often used for internal metadata but should be hidden
     * in the final rendered output or downloaded document.
     * 
     * @param content The raw content to process
     * @returns The processed content with markers removed
     */
    public stripMarkers(content: string | null | undefined): string {
        if (!content) return '';
        
        // Regex to match HTML comments: <!-- any content -->
        // [\s\S]*? handles multiline comments lazily
        return content.replace(/<!--[\s\S]*?-->/g, '').trim();
    }

    /**
     * Extracts a title and a brief summary from a document content.
     * Useful for displaying cards in the chat.
     */
    public extractMetadata(content: string): { title: string, summary: string } {
        const stripped = this.stripMarkers(content);
        
        // Try to find a H1 or GDD header
        const gddMatch = stripped.match(/(?:#|游戏设计文档|Game Design Document|GDD)\s*[:：-]?\s*([^\n]+)/i);
        let title = gddMatch ? gddMatch[1].trim().replace(/^[\s(（)-]+|[\s)）]+$/g, '') : 'Document Artifact';
        
        // If it's a GDD, prefix it like Figure 2
        if (/GDD/i.test(stripped) || /游戏设计文档/i.test(stripped)) {
            if (!title.toLowerCase().startsWith('gdd')) {
                title = `GDD: ${title}`;
            }
        }

        // Summary extraction
        let summary = '';
        
        // Look for common overview sections
        const overviewRegex = /(?:Game Overview|游戏概况|产品愿景|简介|概评)[:：\n]*([\s\S]{10,300})/i;
        const overviewMatch = stripped.match(overviewRegex);
        
        if (overviewMatch) {
            summary = overviewMatch[1].trim().split('\n').filter(l => l.trim().length > 0)[0];
        } 
        
        // Fallback to first meaningful line or sentence
        if (!summary || summary.length < 5) {
             const lines = stripped.split('\n').map(l => l.trim().replace(/[#*`]/g, '')).filter(l => l.length > 20);
             if (lines.length > 0) {
                 summary = lines[0];
             } else {
                 const sentences = stripped.replace(/[#*`]/g, '').trim().split(/[.。!！?？]/);
                 summary = sentences.find(s => s.trim().length > 10)?.trim() || 'Click to view the full document content.';
             }
        }

        if (summary.length > 120) summary = summary.substring(0, 117) + '...';
        return { title, summary };
    }

    /**
     * Determines if the content is likely a document artifact with high confidence.
     * Used as a fallback when system flags are missing.
     */
    public isHighConfidenceDocument(content: string | null | undefined): boolean {
        if (!content || content.length < 300) return false;
        
        const stripped = this.stripMarkers(content);
        
        // Pattern 1: Explicit GDD/Design Doc headers at the start
        const hasDocHeader = /^(?:#|游戏设计文档|Game Design Document|GDD)\s*[:：-]?\s*/i.test(stripped);
        
        // Pattern 2: Typical document sections
        const hasDocSections = /(?:Game Overview|游戏概况|功能说明|需求说明|System Design|系统设计|Overview|Core Loop|核心玩法)/i.test(stripped);
        
        // Pattern 3: Table of contents style
        const hasTOC = /##?\s*(?:目录|Table of Contents|Content)/i.test(stripped);

        // Pattern 4: Technical structure (long content with many headers)
        const headerCount = (stripped.match(/^##?\s+/gm) || []).length;
        
        return hasDocHeader || (content.length > 1500 && hasDocSections) || (headerCount >= 3 && content.length > 1000) || hasTOC;
    }

    public shouldRenderAsArtifactCard(params: {
        content: string | null | undefined;
        renderHint?: string;
        messageType?: string;
        isDocument?: boolean;
    }): boolean {
        const renderHint = String(params.renderHint || '').trim().toLowerCase();
        if (renderHint === 'artifact_card' || renderHint === 'document') return true;
        if (params.messageType === 'artifact_card') return true;
        if (params.isDocument) return true;
        return this.isHighConfidenceDocument(params.content);
    }
}

export const artifactProcessor = ArtifactProcessor.getInstance();
