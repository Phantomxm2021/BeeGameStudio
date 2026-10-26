import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publicationControlsFromGdd, readPublicationControls, PUBLIC_DESCRIPTION_SOURCE_LIMIT, PUBLIC_DESCRIPTION_SOURCE_INVALID, publicationDescriptionFromBrief, PUBLIC_DESCRIPTION_BRIEF_MISSING, PUBLIC_DESCRIPTION_TOO_LONG } from './publication-description'

const brief = { kind: 'confirmed_build_brief', game_user_visible_language: 'zh',
  idea: 'PRIVATE_REQUEST', selected_option: { title: '港口竞速', pitch: '抵达灯塔。', gameplay: '收集信标，然后驶向终点。', scope: 'PRIVATE_SCOPE' },
  settings: { inputs: ['Keyboard/mouse', 'Gamepad'], notes: 'PRIVATE_NOTES' },
  confirmed_gdd: 'PRIVATE_DESIGN', user_messages: [{ text: 'PRIVATE_CHAT' }], reference_files: ['PRIVATE_PATH'] }

test('copies only confirmed public fields, with no inferred key mappings or private request data', () => {
  const source = JSON.stringify(brief)
  expect(publicationDescriptionFromBrief(source)).toBe('# 港口竞速\n\n## 操作\n- 键鼠\n- 手柄\n\n设计文档未提供具体操作说明，请在发布前补充。\n\n## 游戏介绍\n抵达灯塔。\n\n## 玩法\n收集信标，然后驶向终点。')
  expect(JSON.stringify(brief)).toBe(source)
  expect(publicationDescriptionFromBrief(source)).not.toContain('PRIVATE')
})

test('marks missing controls explicitly and omits duplicate introduction', () => {
  const source = { kind: 'confirmed_build_brief', selected_option: { gameplay: 'Find the exit', pitch: 'Find the exit' }, settings: { inputs: ['PRIVATE_CUSTOM_INPUT'] } }
  expect(publicationDescriptionFromBrief(JSON.stringify(source), 'en')).toBe('## Controls\nDetailed controls are not documented. Add them before publishing.\n\n## How to play\nFind the exit')
})

test('plain brief text cannot introduce Markdown images, links, HTML or headings', () => {
  const source = { ...brief, selected_option: { title: 'A\n## B', gameplay: '![image](https://private.example) <script>\n# heading' } }
  const description = publicationDescriptionFromBrief(JSON.stringify(source), 'en')
  expect(description).toContain('\\!\\[image\\]\\(https://private\\.example\\)')
  expect(description).toContain('\\<script\\>')
  expect(description).not.toContain('\n# heading')
  expect(description).not.toContain('\n## B')
})

test.each([undefined, '{', '{}', JSON.stringify({ kind: 'summary', selected_option: { gameplay: 'Wrong kind' } }),
  JSON.stringify({ kind: 'confirmed_build_brief', idea: 'Private request only', selected_option: {} })])('missing public brief content fails explicitly: %s', source => {
  expect(() => publicationDescriptionFromBrief(source)).toThrow(PUBLIC_DESCRIPTION_BRIEF_MISSING)
})

test('does not silently truncate an oversized confirmed brief', () => {
  expect(() => publicationDescriptionFromBrief(JSON.stringify({ ...brief, selected_option: { gameplay: '游'.repeat(4001) } })))
    .toThrow(PUBLIC_DESCRIPTION_TOO_LONG)
})


test('extracts documented controls, preserving key labels, lists and tables without adjacent design prose', () => {
  const source = '# Design\n## Movement and controls\n### Available controls\n- `J` / `L`: move\n- `Space`: interact\n\n### Timing implementation\nPRIVATE_TIMING\n## 4. **按键映射**\n| 按键 | 动作 |\n|---|---|\n| Esc | 暂停 |\n## Resources\nPRIVATE_RESOURCES';
  const controls = publicationControlsFromGdd(source);
  expect(controls).toBe('- `J` / `L`: move\n- `Space`: interact\n\n| 按键 | 动作 |\n|---|---|\n| Esc | 暂停 |');
  const draft = publicationDescriptionFromBrief(JSON.stringify(brief), 'zh', controls);
  expect(draft).toContain('## 操作\n' + controls);
  expect(draft).not.toContain('PRIVATE');
  expect(draft).not.toContain('未提供');
});

test('keeps device subsection labels and ignores false headings inside fences and quoted examples', () => {
  const source = '# Design\n```md\n## Controls\nPRIVATE_CODE\n```\n> ## Controls\n> PRIVATE_QUOTE\n\nControls\n========\n### Keyboard\n- Enter: start\n### Gamepad controls\n- South button: start\n### Developer notes\nPRIVATE_NOTES';
  expect(publicationControlsFromGdd(source)).toBe('### Keyboard\n\n- Enter: start\n\n### Gamepad controls\n\n- South button: start');
  expect(publicationControlsFromGdd('# Design\nThe word controls appears in a sentence.')).toBe('');
});

test('does not embed remote images, URLs, HTML or executable examples from a control section', () => {
  const controls = publicationControlsFromGdd('## Controls\nPress **Enter** to [start](https://private.example).\n\n![private](https://private.example/pixel)\n\n<script>PRIVATE_SCRIPT</script>\n\n```js\nPRIVATE_CODE\n```');
  expect(controls).toBe('Press **Enter** to start.');
});

test('reads the saved merged GDD without indexes or project writes and rejects unsafe or oversized sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-controls-'));
  const workspace = join(root, 'workspace'), path = join(workspace, 'docs/GDD.md');
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true });
    expect(await readPublicationControls(workspace)).toBe('');
    const source = '# Design\n' + 'Other design content.\n'.repeat(8000) + '\n## 操作说明\n- `Enter`：确认\n';
    await writeFile(path, source);
    expect(await readPublicationControls(workspace)).toBe('- `Enter`：确认');
    expect(await readFile(path, 'utf8')).toBe(source);
    await writeFile(path, 'x'.repeat(PUBLIC_DESCRIPTION_SOURCE_LIMIT + 1));
    await expect(readPublicationControls(workspace)).rejects.toThrow(PUBLIC_DESCRIPTION_SOURCE_INVALID);
    await rm(path);
    const outside = join(root, 'outside.md');
    await writeFile(outside, '## Controls\nPRIVATE_EXTERNAL');
    await symlink(outside, path);
    await expect(readPublicationControls(workspace)).rejects.toThrow(PUBLIC_DESCRIPTION_SOURCE_INVALID);
  } finally { await rm(root, { recursive: true, force: true }); }
});
