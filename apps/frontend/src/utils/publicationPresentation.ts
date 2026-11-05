export type PublicationSection = { kind: 'controls' | 'introduction' | 'gameplay'; heading: string; text: string };
const headings = {
  controls: ['操作', '操作说明', '操作說明', '操作指南', '操作方案', '控制方案', 'controls', '操作方法', '조작', 'commandes', 'steuerung', 'controles', 'comandi'],
  introduction: ['游戏介绍', '遊戲介紹', '游戏简介', '遊戲簡介', '简介', '簡介', 'introduction', 'about', 'ゲーム紹介', '게임 소개', 'présentation', 'einführung', 'introducción', 'introduzione', 'introdução'],
  gameplay: ['玩法', '游戏玩法', '遊戲玩法', '怎么玩', '怎麼玩', '如何游玩', 'how to play', 'gameplay', '你的目标', '你的目標', '游戏目标', '遊戲目標', 'goals', '遊び方', '플레이 방법', 'comment jouer', 'spielablauf', 'cómo jugar', 'come giocare', 'como jogar'],
} as const;
const sectionKind = (heading: string) => (Object.keys(headings) as PublicationSection['kind'][])
  .find(kind => (headings[kind] as readonly string[]).includes(heading.toLowerCase()));
const headingText = (line: string) => line.trim().replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1').replace(/\\([!-/:-@\[-`{-~])/g, '$1').trim();

/** A reviewed public H1 names the release; never infer a title from body prose or private documents. */
export function publicationTitle(description: string | undefined, fallback: string): string {
  const first = description?.trim().split(/\r?\n/, 1)[0] || '';
  if (!/^#\s+\S/.test(first)) return fallback;
  const title = headingText(first).replace(/^《(.+)》$/, '$1');
  return title && !sectionKind(title) ? title : fallback;
}

/** Display existing sections in player order without rewriting their content. */
export function publicationSections(description: string, fallbackTitle: string): PublicationSection[] {
  const lines = description.trim().split(/\r?\n/);
  const title = publicationTitle(description, fallbackTitle);
  const first = headingText(lines[0] || '').replace(/^《(.+)》$/, '$1');
  if (first === title && !sectionKind(first)) lines.shift();
  const sections = new Map<PublicationSection['kind'], { heading: string; lines: string[] }>();
  let kind: PublicationSection['kind'] = 'introduction';
  let fence: { marker: string; length: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    const inCode = Boolean(fence);
    if (delimiter && !fence) fence = { marker: delimiter[0], length: delimiter.length };
    else if (delimiter && fence && delimiter[0] === fence.marker && delimiter.length >= fence.length) fence = undefined;
    const heading = headingText(line);
    const named = !inCode && !delimiter &&
      (/^#{1,6}\s+/.test(line.trim()) || ((!index || !lines[index - 1].trim()) && (!lines[index + 1] || !lines[index + 1].trim())))
      ? sectionKind(heading) : undefined;
    if (named) {
      kind = named;
      const existing = sections.get(kind);
      if (!existing) sections.set(kind, { heading, lines: [] });
      // Preserve later subheadings, e.g. goals followed by how-to-play.
      else if (existing.lines.some(line => line.trim())) existing.lines.push('', `### ${heading}`, '');
      continue;
    }
    if (!sections.has(kind) && !line.trim()) continue;
    if (!sections.has(kind)) sections.set(kind, { heading: '游戏介绍', lines: [] });
    sections.get(kind)!.lines.push(line);
  }
  return (['controls', 'introduction', 'gameplay'] as const).flatMap(kind => {
    const section = sections.get(kind), text = section?.lines.join('\n').trim();
    if (!text) return [];
    // Keep heading language for authored English releases, normalize Chinese labels.
    const heading = /^[A-Za-z ]+$/.test(section!.heading)
      ? ({ controls: 'Controls', introduction: 'Introduction', gameplay: 'How to play' })[kind]
      : ({ controls: '操作', introduction: '游戏介绍', gameplay: '玩法' })[kind];
    return [{ kind, heading, text }];
  });
}
