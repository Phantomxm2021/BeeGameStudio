import { describe, expect, it } from 'vitest';
import { getProjectDisplayName } from './projectDisplayName';

describe('getProjectDisplayName', () => {
  it('removes only generated suffixes from workspace names on each OS', () => {
    expect(getProjectDisplayName({ root_path: '/projects/flag-pole--b28215fb9287/' }, 'Untitled')).toBe('flag-pole');
    expect(getProjectDisplayName({ root_path: 'C:\\projects\\游戏--b28215fb9287' }, 'Untitled')).toBe('游戏');
    expect(getProjectDisplayName({ name: '游戏--b28215fb9287' }, 'Untitled')).toBe('游戏');
  });
  it('preserves authored names and falls back rather than displaying generated IDs', () => {
    expect(getProjectDisplayName({ name: 'Snake 2 - Final' }, 'Untitled')).toBe('Snake 2 - Final');
    expect(getProjectDisplayName({ name: 'Project-X' }, 'Untitled')).toBe('Project-X');
    expect(getProjectDisplayName({ name: 'project_1790059363814_s1fwp3' }, 'Untitled')).toBe('Untitled');
    expect(getProjectDisplayName({ root_path: '/projects/a896be58bebc', name: '贪吃蛇' }, 'Untitled')).toBe('贪吃蛇');
  });
});
