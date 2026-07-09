export type AttachmentBuildSource = 'gdd' | 'image' | 'mixed';
export type AttachmentBuildCompleteness = 'complete' | 'partial' | 'unknown';
export type AttachmentBuildConfidence = 'high' | 'medium' | 'low';

export type AttachmentBuildAnalysis = {
    analysisId: string;
    sourceType: AttachmentBuildSource;
    completeness: AttachmentBuildCompleteness;
    confirmedFacts: Array<{ field: string; value: string; source: string }>;
    inferredDesign: Array<{
        field: string;
        value: string;
        confidence: AttachmentBuildConfidence;
        source: string;
    }>;
    missingFields: Array<{ field: string; reason: string }>;
    conflicts: Array<{
        field: string;
        gddValue: string;
        imageValue: string;
        resolution: 'needs_user_choice';
    }>;
    gddDraft: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === 'string';
const isSource = (value: unknown): value is AttachmentBuildSource => value === 'gdd' || value === 'image' || value === 'mixed';
const isCompleteness = (value: unknown): value is AttachmentBuildCompleteness => value === 'complete' || value === 'partial' || value === 'unknown';
const isConfidence = (value: unknown): value is AttachmentBuildConfidence => value === 'high' || value === 'medium' || value === 'low';

export const normalizeAttachmentBuildAnalysis = (value: unknown): AttachmentBuildAnalysis => {
    if (!isRecord(value) || !isString(value.analysisId) || !isSource(value.sourceType) || !isCompleteness(value.completeness) || !isString(value.gddDraft)) {
        throw new Error('Invalid attachment build analysis');
    }
    const confirmedFacts = Array.isArray(value.confirmedFacts) ? value.confirmedFacts : [];
    const inferredDesign = Array.isArray(value.inferredDesign) ? value.inferredDesign : [];
    const missingFields = Array.isArray(value.missingFields) ? value.missingFields : [];
    const conflicts = Array.isArray(value.conflicts) ? value.conflicts : [];
    if (!confirmedFacts.every(item => isRecord(item) && isString(item.field) && isString(item.value) && isString(item.source))) {
        throw new Error('Invalid attachment build analysis');
    }
    if (!inferredDesign.every(item => isRecord(item) && isString(item.field) && isString(item.value) && isConfidence(item.confidence) && isString(item.source))) {
        throw new Error('Invalid attachment build analysis');
    }
    if (!missingFields.every(item => isRecord(item) && isString(item.field) && isString(item.reason))) {
        throw new Error('Invalid attachment build analysis');
    }
    if (!conflicts.every(item => isRecord(item) && isString(item.field) && isString(item.gddValue) && isString(item.imageValue) && item.resolution === 'needs_user_choice')) {
        throw new Error('Invalid attachment build analysis');
    }
    return {
        analysisId: value.analysisId,
        sourceType: value.sourceType,
        completeness: value.completeness,
        confirmedFacts: confirmedFacts as AttachmentBuildAnalysis['confirmedFacts'],
        inferredDesign: inferredDesign as AttachmentBuildAnalysis['inferredDesign'],
        missingFields: missingFields as AttachmentBuildAnalysis['missingFields'],
        conflicts: conflicts as AttachmentBuildAnalysis['conflicts'],
        gddDraft: value.gddDraft,
    };
};
