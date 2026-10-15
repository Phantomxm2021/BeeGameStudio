export const WORKSPACE_ROUTE_CHANGE_EVENT = 'beegame-workspace-route-change';

export type ProjectEditorRoute = 'scene' | 'ui';

const PROJECT_QUERY = 'project';
const EDITOR_QUERY = 'editor';
const EDITOR_FILE_QUERY = 'editorFile';

const currentUrl = (): URL | null =>
  typeof window === 'undefined' ? null : new URL(window.location.href);

export function getProjectRouteId(): string | null {
  return currentUrl()?.searchParams.get(PROJECT_QUERY)?.trim() || null;
}

export function getProjectEditorRoute(projectId?: string): ProjectEditorRoute | null {
  const url = currentUrl();
  if (!url) return null;
  if (projectId && url.searchParams.get(PROJECT_QUERY) !== projectId) return null;
  const editor = url.searchParams.get(EDITOR_QUERY);
  return editor === 'scene' || editor === 'ui' ? editor : null;
}

/**
 * Return the document path requested by the current editor route, if any.
 *
 * The editor file is deliberately kept separate from the editor kind so that
 * the existing project/editor route remains backwards compatible for callers
 * that open the editor without selecting a document first.
 */
export function getProjectEditorFileRoute(projectId?: string): string | null {
  const url = currentUrl();
  if (!url) return null;
  if (projectId && url.searchParams.get(PROJECT_QUERY) !== projectId) return null;
  const editor = url.searchParams.get(EDITOR_QUERY);
  if (editor !== 'scene' && editor !== 'ui') return null;
  return url.searchParams.get(EDITOR_FILE_QUERY)?.trim() || null;
}

export function notifyWorkspaceRouteChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WORKSPACE_ROUTE_CHANGE_EVENT));
}

export function openProjectRoute(projectId: string, options: { replace?: boolean } = {}): void {
  const url = currentUrl();
  const normalizedProjectId = projectId.trim();
  if (!url || !normalizedProjectId) return;
  url.pathname = '/';
  url.searchParams.set(PROJECT_QUERY, normalizedProjectId);
  url.searchParams.delete(EDITOR_QUERY);
  url.searchParams.delete(EDITOR_FILE_QUERY);
  url.searchParams.delete('resourceLibrary');
  url.searchParams.delete('resourcePack');
  window.history[options.replace ? 'replaceState' : 'pushState']({ projectId: normalizedProjectId }, '', url);
  notifyWorkspaceRouteChanged();
}

export function openProjectEditorRoute(projectId: string, editor: ProjectEditorRoute): void {
  const url = currentUrl();
  const normalizedProjectId = projectId.trim();
  if (!url || !normalizedProjectId) return;
  url.pathname = '/';
  url.searchParams.set(PROJECT_QUERY, normalizedProjectId);
  url.searchParams.set(EDITOR_QUERY, editor);
  url.searchParams.delete(EDITOR_FILE_QUERY);
  url.searchParams.delete('resourceLibrary');
  url.searchParams.delete('resourcePack');
  window.history.pushState({ projectId: normalizedProjectId, editor }, '', url);
  notifyWorkspaceRouteChanged();
}

/**
 * Open one project editor document in a separate browser tab.
 *
 * Unlike openProjectEditorRoute this does not mutate the current tab's
 * history. URLSearchParams performs the required encoding for document paths
 * containing slashes, spaces, unicode, or query-like characters.
 */
export function openProjectEditorFileRoute(
  projectId: string,
  editor: ProjectEditorRoute,
  documentPath: string,
): Window | null {
  const url = currentUrl();
  const normalizedProjectId = projectId.trim();
  const normalizedDocumentPath = documentPath.trim();
  if (!url || !normalizedProjectId || !normalizedDocumentPath) return null;
  url.pathname = '/';
  url.searchParams.set(PROJECT_QUERY, normalizedProjectId);
  url.searchParams.set(EDITOR_QUERY, editor);
  url.searchParams.set(EDITOR_FILE_QUERY, normalizedDocumentPath);
  url.searchParams.delete('resourceLibrary');
  url.searchParams.delete('resourcePack');
  return window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

export function closeProjectEditorRoute(projectId: string): void {
  // Document routes open in their own tab; keep in-page editors in the project tab.
  if (getProjectEditorFileRoute(projectId)) {
    window.close();
    if (window.closed) return;
  }
  // Manually opened tabs may not be script-closable.
  openProjectRoute(projectId, { replace: true });
}

export function openIdeaHomeRoute(options: { replace?: boolean } = {}): void {
  const url = currentUrl();
  if (!url) return;
  url.pathname = '/';
  url.searchParams.delete(PROJECT_QUERY);
  url.searchParams.delete(EDITOR_QUERY);
  url.searchParams.delete(EDITOR_FILE_QUERY);
  url.searchParams.delete('resourceLibrary');
  url.searchParams.delete('resourcePack');
  window.history[options.replace ? 'replaceState' : 'pushState']({}, '', url);
  notifyWorkspaceRouteChanged();
}
