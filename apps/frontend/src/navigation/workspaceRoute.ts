export const WORKSPACE_ROUTE_CHANGE_EVENT = 'beegame-workspace-route-change';

export type ProjectEditorRoute = 'scene' | 'ui';

const PROJECT_QUERY = 'project';
const EDITOR_QUERY = 'editor';

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
  url.searchParams.delete('resourceLibrary');
  url.searchParams.delete('resourcePack');
  window.history.pushState({ projectId: normalizedProjectId, editor }, '', url);
  notifyWorkspaceRouteChanged();
}

export function closeProjectEditorRoute(projectId: string): void {
  openProjectRoute(projectId, { replace: true });
}

export function openIdeaHomeRoute(options: { replace?: boolean } = {}): void {
  const url = currentUrl();
  if (!url) return;
  url.pathname = '/';
  url.searchParams.delete(PROJECT_QUERY);
  url.searchParams.delete(EDITOR_QUERY);
  url.searchParams.delete('resourceLibrary');
  url.searchParams.delete('resourcePack');
  window.history[options.replace ? 'replaceState' : 'pushState']({}, '', url);
  notifyWorkspaceRouteChanged();
}
