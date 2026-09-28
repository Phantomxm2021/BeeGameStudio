const UNIX_ABSOLUTE_PATH = /(?<![:/\w])\/(?:Users|home|root|private|var|tmp|opt|usr|etc|Volumes|workspace|workspaces|mnt|Applications|System|Library|dev)(?:\/[^/\s"'`<>()\[\]{}，。；：、]+)+\/?/g;
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\(?:[^\\\s"'`<>()\[\]{}，。；：、]+\\){1,}[^\\\s"'`<>()\[\]{}，。；：、]*/g;
const FILE_URL_PATH = /file:\/\/\/(?:[^/\s"'`<>()\[\]{}，。；：、]+\/)*[^/\s"'`<>()\[\]{}，。；：、]*/gi;
const HOME_PATH = /(?<![\w])~\/(?:[^/\s"'`<>()\[\]{}，。；：、]+\/)*[^/\s"'`<>()\[\]{}，。；：、]*/g;
const INTERNAL_WORKFLOW_PATH = /(?:\.beegame\/workflow|review-context)(?:\/[^/\s"'`<>()\[\]{}，。；：、]+)+\/?/g;
const RELATIVE_PATH_TOKEN = /(?<![\w./:])(?:\.{1,2}\/)?(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+/g;
const PATH_ROOTS = new Set([
    'src', 'app', 'apps', 'packages', 'docs', 'assets', 'content', 'public', 'dist', 'build',
    'test', 'tests', '__tests__', '.beegame', 'workspace', 'workspaces', 'Users', 'home', 'private',
    'tmp', 'var', 'Volumes', 'mnt', 'root', 'node_modules',
]);

function isRelativeFilePath(token: string): boolean {
    if (token.startsWith('./') || token.startsWith('../')) return true;
    const segments = token.split('/');
    const filename = segments.at(-1) || '';
    return segments.some(segment => PATH_ROOTS.has(segment)) || /\.[A-Za-z0-9]{1,10}$/.test(filename);
}

function pathFileName(value: string): string {
    const trimmed = value.replace(/[\\/]+$/, '');
    return trimmed.split(/[\\/]/).at(-1) || value;
}

/**
 * Hides filesystem paths from Chat presentation only.
 * The underlying transcript and tool payloads remain unchanged.
 */
const HTTP_URL = /(https?:\/\/[^\s"'`<>()\[\]{}]+)/gi;

const filterPathSegment = (value: string): string => value
    .replace(FILE_URL_PATH, pathFileName)
    .replace(WINDOWS_ABSOLUTE_PATH, pathFileName)
    .replace(UNIX_ABSOLUTE_PATH, pathFileName)
    .replace(HOME_PATH, pathFileName)
    .replace(INTERNAL_WORKFLOW_PATH, pathFileName)
    .replace(RELATIVE_PATH_TOKEN, token => isRelativeFilePath(token) ? pathFileName(token) : token);

export const filterPathsForDisplay = (value: string): string => value
    .split(HTTP_URL)
    .map(segment => /^https?:\/\//i.test(segment) ? segment : filterPathSegment(segment))
    .join('');

/** @deprecated Prefer the explicit filter name; retained for existing Chat call sites. */
export const shortenAbsolutePathsForDisplay = filterPathsForDisplay;
