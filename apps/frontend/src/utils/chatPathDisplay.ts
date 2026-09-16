const UNIX_ABSOLUTE_PATH = /(?<![:/\w])\/(?:Users|home|root|private|var|tmp|opt|Volumes|workspace|workspaces)(?:\/[^/\s"'`<>()\[\]{}，。；：、]+)+\/?/g;
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\(?:[^\\\s"'`<>()\[\]{}，。；：、]+\\){2,}[^\\\s"'`<>()\[\]{}，。；：、]*/g;
const INTERNAL_WORKFLOW_PATH = /(?:\.beegame\/workflow|review-context)(?:\/[^/\s"'`<>()\[\]{}，。；：、]+)+\/?/g;

const pathLeaf = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/, '');
    const segments = trimmed.split(/[\\/]/);
    return segments.at(-1) || value;
};

/**
 * Removes machine-specific directory structure from chat presentation only.
 * The underlying transcript and tool payloads remain unchanged.
 */
export const shortenAbsolutePathsForDisplay = (value: string): string => value
    .replace(WINDOWS_ABSOLUTE_PATH, pathLeaf)
    .replace(UNIX_ABSOLUTE_PATH, pathLeaf)
    .replace(INTERNAL_WORKFLOW_PATH, pathLeaf);
