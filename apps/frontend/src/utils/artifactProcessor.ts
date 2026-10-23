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
        
        const lines = stripped.split('\n').map(line => line.trim()).filter(Boolean);
        const heading = lines.find(line => /^#\s+/.test(line));
        const title = heading?.replace(/^#\s+/, '').trim() || 'Document Artifact';
        let summary = lines.find(line => line !== heading && !line.startsWith('#'))
            ?.replace(/^[*`\s]+|[*`\s]+$/g, '') || 'Click to view the full document content.';

        if (summary.length > 120) summary = summary.substring(0, 117) + '...';
        return { title, summary };
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
        return false;
    }
}

export const artifactProcessor = ArtifactProcessor.getInstance();
