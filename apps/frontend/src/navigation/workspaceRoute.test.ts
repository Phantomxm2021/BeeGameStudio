import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProjectEditorRoute,
  getProjectRouteId,
  openIdeaHomeRoute,
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

  it('notifies mounted surfaces when history state changes programmatically', () => {
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, listener);
    openProjectRoute('project-1');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, listener);
  });
});
