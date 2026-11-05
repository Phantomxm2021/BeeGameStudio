import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'

export const PUBLIC_DESCRIPTION_LIMIT = 4000
export const PUBLIC_DESCRIPTION_BRIEF_MISSING = 'No confirmed brief with player-facing content is available; enter the description manually'
export const PUBLIC_DESCRIPTION_TOO_LONG = 'The publication draft exceeds the description limit; enter a shorter description manually'

const headings: Record<string, [string, string, string]> = {
  en: ['Controls', 'Introduction', 'How to play'],
  zh: ['操作', '游戏介绍', '玩法'],
  'zh-TW': ['操作', '遊戲介紹', '玩法'],
  ja: ['操作方法', 'ゲーム紹介', '遊び方'],
  ko: ['조작', '게임 소개', '플레이 방법'],
  fr: ['Commandes', 'Présentation', 'Comment jouer'],
  de: ['Steuerung', 'Einführung', 'Spielablauf'],
  es: ['Controles', 'Introducción', 'Cómo jugar'],
  it: ['Comandi', 'Introduzione', 'Come giocare'],
  pt: ['Controles', 'Introdução', 'Como jogar'],
}
const inputNames: Record<string, [string, string]> = {
  'Keyboard/mouse': ['键鼠', '鍵鼠'], Gamepad: ['手柄', '手把'], Touch: ['触屏', '觸控'],
  Motion: ['体感', '體感'], Voice: ['语音', '語音'], 'Hand tracking': ['手势追踪', '手勢追蹤'],
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
// Brief fields are plain text. Keep their contents from becoming Markdown links,
// images, HTML or additional headings when placed inside the public draft.
const literal = (value: string) => value.replace(/[\\`*_{}\[\]()#+.!|<>~\-]/g, '\\$&')

export const PUBLIC_DESCRIPTION_SOURCE_LIMIT = 256 * 1024
export const PUBLIC_DESCRIPTION_SOURCE_INVALID = 'Cannot read the saved GDD controls; check docs/GDD.md or enter the description manually'

// Match control-section titles, not mentions in ordinary prose or code examples.
const controlsTitle = /(?:操作(?:说明|說明|指南|方式|规则|規則|映射)?|按键(?:说明|映射|绑定)?|按鍵(?:說明|映射|綁定)?|键位(?:说明|映射|绑定)?|鍵位(?:說明|映射|綁定)?|控制(?:方式|说明|說明)|\bcontrols?|\bkey\s*(?:bindings?|mapping)|\binput mapping|输入映射|輸入映射|操作方法|조작(?: 방법)?|commandes|steuerung|controles|comandi)\s*$/i
const deviceTitle = /^(?:键盘|鍵盤|鼠标|滑鼠|键鼠|鍵鼠|手柄|手把|触屏|觸控|keyboard|mouse|keyboard\s*(?:and|[&/])\s*mouse|gamepad|controller|touch)(?:操作|控制|方案|说明|說明| controls?| bindings?)?$/i
const titleText = (node: { value?: string; children?: any[] }): string => node.value ?? node.children?.map(titleText).join('') ?? ''

// Retain authored Markdown lists/tables and key labels, but never embed external
// images, links, raw HTML or code blocks in the public draft.
function controlMarkdown(node: any, source: string): string {
  if (['image', 'imageReference', 'html', 'code', 'definition'].includes(node.type)) return ''
  if (['link', 'linkReference'].includes(node.type)) return node.children.map((child: any) => controlMarkdown(child, source)).join('')
  const start = node.position.start.offset
  let body = source.slice(start, node.position.end.offset)
  for (const child of [...(node.children ?? [])].reverse()) {
    body = body.slice(0, child.position.start.offset - start) + controlMarkdown(child, source) + body.slice(child.position.end.offset - start)
  }
  return body
}

export function publicationControlsFromGdd(source: string): string {
  const blocks: string[] = []
  let controlDepth = 0
  for (const node of fromMarkdown(source).children) {
    if (node.type === 'heading') {
      const title = titleText(node).replace(/^\s*(?:\d+[.、)]?\s*)+/, '').trim()
      if (controlDepth && node.depth > controlDepth && deviceTitle.test(title)) blocks.push('### ' + literal(title))
      else if (controlsTitle.test(title)) controlDepth = node.depth
      else controlDepth = 0
      continue
    }
    if (controlDepth && (node.type === 'paragraph' || node.type === 'list')) {
      const body = controlMarkdown(node, source).trim()
      if (body) blocks.push(body)
    }
  }
  return blocks.join('\n\n')
}

/** Read one bounded, regular project file; missing GDD has no detailed bindings. */
export async function readPublicationControls(workspace: string): Promise<string> {
  let file
  try {
    const root = await realpath(workspace), path = join(root, 'docs/GDD.md'), resolved = await realpath(path)
    if (!resolved.startsWith(root + sep) || resolved !== path) throw Error('Symlinked source')
    file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    if (!(await file.stat()).isFile()) throw Error('Non-regular source')
    const bytes = Buffer.alloc(PUBLIC_DESCRIPTION_SOURCE_LIMIT + 1)
    let size = 0
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > PUBLIC_DESCRIPTION_SOURCE_LIMIT) throw Error('Oversized source')
    return publicationControlsFromGdd(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw Error(PUBLIC_DESCRIPTION_SOURCE_INVALID)
  } finally { await file?.close() }
}

/** Format confirmed public fields plus documented controls; no model or billing. */
export function publicationDescriptionFromBrief(context: string | undefined, language?: string, controls = ''): string {
  let brief: unknown
  try { brief = JSON.parse(context ?? '') } catch { throw Error(PUBLIC_DESCRIPTION_BRIEF_MISSING) }
  if (!record(brief) || brief.kind !== 'confirmed_build_brief' || !record(brief.selected_option))
    throw Error(PUBLIC_DESCRIPTION_BRIEF_MISSING)
  const option = brief.selected_option
  const pitch = text(option.pitch), gameplay = text(option.gameplay)
  if (!pitch && !gameplay) throw Error(PUBLIC_DESCRIPTION_BRIEF_MISSING)
  const lang = language || text(brief.game_user_visible_language) || 'en'
  const [controlsHeading, introductionHeading, gameplayHeading] = headings[lang] ?? headings.en!
  const sections: string[] = []
  const title = text(option.title).replace(/\s+/g, ' ')
  if (title) sections.push('# ' + literal(title))
  const inputs = record(brief.settings) && Array.isArray(brief.settings.inputs)
    ? [...new Set(brief.settings.inputs.filter((value): value is string => typeof value === 'string' && Object.hasOwn(inputNames, value)))] : []
  const names = inputs.map(value => lang === 'zh' ? inputNames[value]![0] : lang === 'zh-TW' ? inputNames[value]![1] : value)
  const controlText = controls.trim() || names.map(value => '- ' + literal(value)).join('\n')
  if (controlText) sections.push('## ' + controlsHeading + '\n' + controlText)
  if (pitch && pitch !== gameplay) sections.push('## ' + introductionHeading + '\n' + literal(pitch))
  if (gameplay) sections.push('## ' + gameplayHeading + '\n' + literal(gameplay))
  const description = sections.join('\n\n')
  if (description.length > PUBLIC_DESCRIPTION_LIMIT) throw Error(PUBLIC_DESCRIPTION_TOO_LONG)
  return description
}
