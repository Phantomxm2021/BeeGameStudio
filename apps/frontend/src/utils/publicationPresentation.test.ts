import { describe, expect, it } from 'vitest';
import { publicationSections, publicationTitle } from './publicationPresentation';

describe('public release presentation', () => {
  it('uses the reviewed title and moves controls ahead of introduction and gameplay without losing extra sections', () => {
    const text = '# 《星港夜航》\n\n## 游戏简介\n守住航道。\n\n## 你的目标\n坚持到天亮。\n\n## 操作\n- E：补给\n\n## 怎么玩\n往返港口。\n\n## 提示\n注意风向。';
    expect(publicationTitle(text, '内部项目名')).toBe('星港夜航');
    expect(publicationSections(text, '内部项目名')).toEqual([
      { kind: 'controls', heading: '操作', text: '- E：补给' },
      { kind: 'introduction', heading: '游戏介绍', text: '守住航道。' },
      { kind: 'gameplay', heading: '玩法', text: '坚持到天亮。\n\n\n### 怎么玩\n\n往返港口。\n\n## 提示\n注意风向。' },
    ]);
  });
  it('displays escaped punctuation from plain brief titles without backslashes', () => {
    const text = '# Orbit \\[A\\] \\- v1\\.0\\!\n\n## How to play\nReach the exit\\.';
    expect(publicationTitle(text, 'Project')).toBe('Orbit [A] - v1.0!');
    expect(publicationSections(text, 'Project')).toEqual([
      { kind: 'gameplay', heading: 'How to play', text: 'Reach the exit\\.' },
    ]);
  });
  it('supports existing plain section labels and leaves unstructured prose intact', () => {
    expect(publicationSections('旧标题\n\n游戏简介\n\n一段介绍\n\n操作\n\nA / D\n\n怎么玩\n\n回到起点', '旧标题').map(section => section.text))
      .toEqual(['A / D', '一段介绍', '回到起点']);
    expect(publicationSections('只有一段完整的介绍，没有章节。', 'Game')).toEqual([
      { kind: 'introduction', heading: '游戏介绍', text: '只有一段完整的介绍，没有章节。' },
    ]);
    expect(publicationSections('', 'Game')).toEqual([]);
  });
  it('does not mistake generic headings or arbitrary first paragraphs for a game title', () => {
    expect(publicationTitle('# 游戏介绍\n文字', 'Saved name')).toBe('Saved name');
    expect(publicationTitle('A sentence introducing the game.', 'Saved name')).toBe('Saved name');
    expect(publicationTitle('## A section\nText', 'Saved name')).toBe('Saved name');
  });
  it('preserves fenced Markdown and does not turn code lines into section boundaries', () => {
    const text = '# Orbit\n\n## Introduction\n```text\n## 操作\ncode\n```\n\n## Controls\nSpace: launch';
    expect(publicationSections(text, 'Project')).toEqual([
      { kind: 'controls', heading: 'Controls', text: 'Space: launch' },
      { kind: 'introduction', heading: 'Introduction', text: '```text\n## 操作\ncode\n```' },
    ]);
  });
});
