import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProjectEditorRoute,
  getProjectEditorFileRoute,
  getProjectRouteId,
  openIdeaHomeRoute,
  openProjectEditorFileRoute,
  openProjectEditorRoute,
  openProjectRoute,
  WORKSPACE_ROUTE_CHANGE_EVENT,
} from './workspaceRoute';

describe('workspaceRoute', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));

  it('makes the project dashboard and editors refreshable', () => {
    openProjectRoute('project-1');
    expect(getProjectRouteId()).toBe('project-1');
    expect(getProjectEditorRoute('project-1')).toBeNull();

    openProjectEditorRoute('project-1', 'scene');
    expect(window.location.search).toContain('editor=scene');
    expect(getProjectEditorRoute('project-1')).toBe('scene');

    openProjectEditorRoute('project-1', 'ui');
    expect(getProjectEditorRoute('project-1')).toBe('ui');
  });

  it('uses the root route as Idea Home instead of restoring a project', () => {
    openProjectEditorRoute('project-1', 'scene');
    openIdeaHomeRoute();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(getProjectRouteId()).toBeNull();
    expect(getProjectEditorRoute()).toBeNull();
  });

  it('opens an encoded document route in a new tab without changing the current tab', () => {
    window.history.replaceState({}, '', '/?resourceLibrary=1&resourcePack=pack-1');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    openProjectEditorFileRoute('project 1', 'ui', 'content/ui/暂停 screen.json?draft=1');

    expect(open).toHaveBeenCalledOnce();
    const [rawUrl, target, features] = open.mock.calls[0];
    const opened = new URL(String(rawUrl), window.location.origin);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
    expect(opened.pathname).toBe('/');
    expect(opened.searchParams.get('project')).toBe('project 1');
    expect(opened.searchParams.get('editor')).toBe('ui');
    expect(opened.searchParams.get('editorFile')).toBe('content/ui/暂停 screen.json?draft=1');
    expect(opened.searchParams.has('resourceLibrary')).toBe(false);
    expect(opened.searchParams.has('resourcePack')).toBe(false);
    expect(window.location.search).toBe('?resourceLibrary=1&resourcePack=pack-1');
  });

  it('reads a selected editor file and cleans it when leaving the editor', () => {
    window.history.replaceState({}, '', '/?project=project-1&editor=scene&editorFile=content%2Fscenes%2Fboss.json');
    expect(getProjectEditorFileRoute('project-1')).toBe('content/scenes/boss.json');

    openProjectEditorRoute('project-1', 'ui');
    expect(getProjectEditorFileRoute('project-1')).toBeNull();
    window.history.replaceState({}, '', '/?project=project-1&editor=ui&editorFile=content%2Fui%2Fmenu.json');
    openIdeaHomeRoute();
    expect(getProjectEditorFileRoute()).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('notifies mounted surfaces when history state changes programmatically', () => {
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, listener);
    openProjectRoute('project-1');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, listener);
  });
});
