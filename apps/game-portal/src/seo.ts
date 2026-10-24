import { publicationSections } from '../../frontend/src/utils/publicationPresentation'

export const PORTAL_SITE_NAME = 'Bee Play · Bee Game Studio（BGS）'
export const BGS_ORGANIZATION = {
  '@type': 'Organization', name: 'Bee Game Studio', alternateName: 'BGS', url: 'https://beegame.studio/',
}
export function portalTitle(gameTitle?: string) {
  return gameTitle ? `${gameTitle} · ${PORTAL_SITE_NAME}` : `Bee Play · 在线玩创作者游戏 | Bee Game Studio（BGS）`
}
// Use only creator-confirmed public copy. Every HTML/JSON output still escapes independently.
export function portalDescription(game?: { title: string; description?: string; authorName?: string }) {
  if (!game) return 'Bee Play 是 Bee Game Studio（BGS）的游戏发布与游玩平台。发现创作者发布的网页游戏，在浏览器中即开即玩，分享你喜欢的作品。'
  const sections = publicationSections(game.description || '', game.title)
  const source = sections.find(section => section.kind === 'introduction')?.text
    || sections.find(section => section.kind === 'gameplay')?.text || game.description || ''
  const lines = source.split(/\r?\n/)
  if (lines[0]?.replace(/\s/g, '') === game.title.replace(/\s/g, '')) lines.shift()
  const plain = lines.join('\n').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/^[ \t]*#{1,6}\s+.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/^[ \t]*[>#*-]+[ \t]*/gm, '')
    .replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim()
  const summary = plain.length > 140 ? `${plain.slice(0, 139)}…` : plain
  const intro = summary || `游玩《${game.title}》${game.authorName ? `，由 ${game.authorName} 创作` : ''}。`
  return `${intro} 在 Bee Play 即开即玩，由 Bee Game Studio（BGS）提供平台支持。`
}
