import { portalTitle, portalDescription } from '../src/seo'
import { renderPublicationDescription } from '../../frontend/src/entrypoints/portalDescription'
const $ = id => document.getElementById(id)
const projectId = /^\/g\/([A-Za-z0-9_-]{1,128})\/?$/.exec(
  location.pathname,
)?.[1]
const deploymentId =
  /^\/deployments\/([A-Za-z0-9_-]{1,128})\/files\/index\.html$/.exec(
    location.pathname,
  )?.[1]
const isGame = Boolean(projectId || deploymentId)
$('catalogue').hidden = isGame
$('game-page').hidden = !isGame
function setPageLoading(loading) {
  $('main').classList.toggle('is-loading', loading)
  $('main').setAttribute('aria-busy', String(loading))
  $('page-loading').hidden = !loading
  document.querySelector('.site-header').inert = loading
}
const author = new URLSearchParams(location.search).get('author')
$('home-title').hidden = Boolean(author)
$('catalogue-heading').hidden = !author
const monogram = title => [...title].slice(0, 2).join('')
const hueFor = id =>
  ([...id].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 360, 0) *
    137.508) %
  360
// Older releases without creator-supplied artwork retain their title graphic.
function coverFor(item) {
  if (item.coverUrl) return item.coverUrl
  const hue = hueFor(item.projectId)
  const title = monogram(item.title).replace(
    /[<>&"']/g,
    character =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <defs><linearGradient id="background" x2=".8" y2="1"><stop stop-color="hsl(${hue},65%,82%)"/><stop offset="1" stop-color="hsl(${hue + 30},55%,47%)"/></linearGradient><linearGradient id="tile" x2=".7" y2="1"><stop stop-color="hsl(${hue},70%,65%)"/><stop offset="1" stop-color="hsl(${hue + 30},60%,35%)"/></linearGradient></defs>
    <rect width="1200" height="900" fill="url(#background)"/>
    <g fill="none" stroke="#fff" stroke-opacity=".2"><circle cx="650" cy="350" r="340" stroke-width="90"/><circle cx="650" cy="350" r="450" stroke-width="2"/></g>
    <g transform="translate(600 350) rotate(-12)"><rect x="-200" y="-200" width="400" height="400" rx="96" fill="#000" opacity=".09" transform="translate(14 24)"/><rect x="-200" y="-200" width="400" height="400" rx="96" fill="url(#tile)" stroke="#fff" stroke-opacity=".35"/><text x="0" y="12" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="145" font-weight="600">${title}</text></g>
    <path d="m980 105 17 48 48 17-48 17-17 48-17-48-48-17 48-17Z" fill="#fff" opacity=".65"/>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const featureTrack = $('feature-track')
const featureDots = $('feature-dots')
const featurePlayback = $('feature-playback')
let featureIndex = 0
let featureElapsed = 0
let featurePaused = reducedMotion.matches
let featureEnded = false
let featureVisible = false
let featureTransition
let featureFrame = 0
let featureLastTime = 0
const featureHoldDuration = 6150
const featureSlideDuration = 1000
function updateCarousel() {
  for (const [index, dot] of [...featureDots.children].entries())
    dot.setAttribute('aria-current', String(index === featureIndex))
  featureDots.style.setProperty('--feature-progress', String(featureElapsed / featureHoldDuration))
  featurePlayback.dataset.state = featureEnded ? 'ended' : featurePaused ? 'paused' : 'playing'
  featurePlayback.setAttribute('aria-label', featureEnded ? '重新播放' : featurePaused ? '开始自动播放' : '暂停自动播放')
}
function featureOffset(index) {
  const slide = featureTrack.children[index]
  return featureTrack.scrollLeft + slide.getBoundingClientRect().left -
    featureTrack.getBoundingClientRect().left - parseFloat(getComputedStyle(featureTrack).paddingLeft)
}
function scrollFeature(index, manual = false, instant = false) {
  if (!featureTrack.children[index]) return
  if (manual) featurePaused = true
  featureIndex = index
  featureElapsed = 0
  featureEnded = false
  const to = featureOffset(index)
  featureTransition = instant || reducedMotion.matches ? undefined : { from: featureTrack.scrollLeft, to, elapsed: 0 }
  featureTrack.classList.toggle('is-moving', Boolean(featureTransition))
  if (!featureTransition) featureTrack.scrollLeft = to
  updateCarousel()
  scheduleFeatureFrame()
}
function scheduleFeatureFrame() {
  if (featureFrame || !featureVisible || document.hidden || featureTrack.children.length < 2) return
  if (!featureTransition && (featurePaused || featureEnded)) return
  featureFrame = requestAnimationFrame(advanceFeature)
}
function advanceFeature(time) {
  featureFrame = 0
  const elapsed = featureLastTime ? time - featureLastTime : 0
  featureLastTime = time
  if (featureTransition) {
    const transition = featureTransition
    transition.elapsed = Math.min(transition.elapsed + elapsed, featureSlideDuration)
    const t = transition.elapsed / featureSlideDuration
    const eased = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    featureTrack.scrollLeft = transition.from + (transition.to - transition.from) * eased
    if (t === 1) {
      featureTransition = undefined
      featureTrack.classList.remove('is-moving')
    }
  } else if (!featurePaused && !featureEnded) {
    featureElapsed = Math.min(featureElapsed + elapsed, featureHoldDuration)
    if (featureElapsed === featureHoldDuration) {
      if (featureIndex < featureTrack.children.length - 1) scrollFeature(featureIndex + 1)
      else featureEnded = true
    }
  }
  updateCarousel()
  scheduleFeatureFrame()
  if (!featureFrame) featureLastTime = 0
}
function suspendFeature() {
  cancelAnimationFrame(featureFrame)
  featureFrame = 0
  featureLastTime = 0
}
function pauseFeatureInteraction() {
  featurePaused = true
  featureTransition = undefined
  featureTrack.classList.remove('is-moving')
  suspendFeature()
  updateCarousel()
}
featurePlayback.addEventListener('click', () => {
  if (featureEnded) {
    featurePaused = false
    scrollFeature(0)
  } else featurePaused = !featurePaused
  updateCarousel()
  scheduleFeatureFrame()
})
for (const event of ['pointerdown', 'wheel', 'focusin'])
  featureTrack.addEventListener(event, pauseFeatureInteraction, { passive: true })
featureTrack.addEventListener('scroll', () => {
  if (featureTransition || !featureTrack.children.length) return
  const nearest = [...featureTrack.children].reduce((best, _, index) =>
    Math.abs(featureOffset(index) - featureTrack.scrollLeft) < Math.abs(featureOffset(best) - featureTrack.scrollLeft) ? index : best, 0)
  if (nearest !== featureIndex) {
    featureIndex = nearest
    featureElapsed = 0
    featureEnded = false
    updateCarousel()
  }
}, { passive: true })
featureTrack.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  scrollFeature(featureIndex + (event.key === 'ArrowRight' ? 1 : -1), true)
})
new ResizeObserver(() => {
  if (featureTrack.children.length) {
    featureTransition = undefined
    featureTrack.classList.remove('is-moving')
    featureTrack.scrollLeft = featureOffset(featureIndex)
  }
}).observe(featureTrack)
new IntersectionObserver(([entry]) => {
  featureVisible = entry.isIntersecting
  if (featureVisible) {
    $('featured').classList.add('has-entered')
    scheduleFeatureFrame()
  } else suspendFeature()
}, { threshold: .15 }).observe(featureTrack)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendFeature()
  else scheduleFeatureFrame()
})
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    pauseFeatureInteraction()
    if (featureTrack.children.length) featureTrack.scrollLeft = featureOffset(featureIndex)
  }
})
function paintFeatures(games) {
  for (const [index, item] of games.slice(0, 5).entries()) {
    const fragment = $('feature-card').content.cloneNode(true)
    fragment.querySelector('.feature-slide').setAttribute('aria-label', `${index + 1} / ${Math.min(games.length, 5)}：${item.title}`)
    const link = fragment.querySelector('.feature-link')
    link.href = `/g/${encodeURIComponent(item.projectId)}`
    link.setAttribute('aria-label', `游玩 ${item.title}（在新标签页打开）`)
    fragment.querySelector('.feature-cover').src = coverFor(item)
    featureTrack.append(fragment)
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.setAttribute('aria-label', `查看 ${item.title}`)
    dot.innerHTML = '<span class="feature-dot-track"><span class="feature-dot-fill"></span></span>'
    dot.addEventListener('click', () => scrollFeature(index, true))
    featureDots.append(dot)
  }
  $('featured').hidden = games.length === 0
  $('featured').querySelector('.carousel-controls').hidden = games.length < 2
  updateCarousel()
  scheduleFeatureFrame()
}
let catalogueAuthor
const accountListeners = new Set()
let accountError = ''
let auth,
  user,
  page = 0,
  catalogueLoading = false
let game,
  gameOrigin = '',
  loadTimer
async function readJson(path) {
  const response = await fetch(path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok)
    throw Error(
      response.status === 404
        ? '游戏尚未发布到 Portal。'
        : '暂时无法连接，请稍后重试。',
    )
  return response.json()
}
function authorUrl(id) {
  return `/?author=${encodeURIComponent(id)}`
}
function paintAccount() {
  for (const listener of accountListeners) listener(user || null)
  if (!isGame && author) {
    const own = user?.id === author
    if (own) $('catalogue-title').textContent = '我的发布'
    else if (catalogueAuthor)
      $('catalogue-title').textContent = `${catalogueAuthor} 的游戏`
  }
}
async function initializeAuth() {
  try {
    const config = await readJson('/api/config')
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      accountError = '登录暂未开放'
      return
    }
    globalThis.BEEGAME_PORTAL_ENV = {
      VITE_SUPABASE_URL: config.supabaseUrl,
      VITE_SUPABASE_ANON_KEY: config.supabaseAnonKey,
    }
    auth = await import('/auth.js')
    await auth.initializeSupabaseSession()
    user = auth.getSupabaseSessionUser()
    accountError = ''
    paintAccount()
    const returnTo = sessionStorage.getItem('beegame_portal_return')
    if (user && returnTo) {
      sessionStorage.removeItem('beegame_portal_return')
      if (/^\/(?:g\/[A-Za-z0-9_-]+\/?|\?author=[A-Za-z0-9_-]+)$/.test(returnTo))
        location.replace(returnTo)
    }
  } catch {
    accountError = '无法连接账号服务，请稍后重试。'
  }
}
export function getPortalAccountUser() {
  return user || null
}
export function subscribePortalAccount(listener) {
  accountListeners.add(listener)
  listener(user || null)
  return () => { accountListeners.delete(listener) }
}
export async function openPortalLogin() {
  if (!auth) await initializeAuth()
  $('login-error').textContent = accountError
  $('submit-login').disabled = !auth
  $('login-dialog').showModal()
}
export function signOutPortalAccount() {
  auth?.clearSupabaseSession()
  user = null
  paintAccount()
}
$('close-login').addEventListener('click', () => $('login-dialog').close())
$('login-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('submit-login').disabled = true
  $('login-error').textContent = ''
  try {
    const session = await auth.signInWithSupabasePassword({
      email: $('email').value,
      password: $('password').value,
    })
    user = session.user
    $('password').value = ''
    paintAccount()
    $('login-dialog').close()
  } catch (error) {
    $('login-error').textContent = error.message || '登录失败，请重试。'
  } finally {
    $('submit-login').disabled = false
  }
})
for (const button of document.querySelectorAll('[data-oauth]'))
  button.addEventListener('click', async () => {
    $('login-error').textContent = ''
    sessionStorage.setItem(
      'beegame_portal_return',
      location.pathname + location.search,
    )
    try {
      await auth.signInWithSupabaseOAuth(button.dataset.oauth)
    } catch (error) {
      $('login-error').textContent = error.message || '登录失败，请重试。'
    }
  })
const catalogueEnd = $('catalogue-end')
const catalogueObserver = new IntersectionObserver(
  entries => {
    if (entries.some(entry => entry.isIntersecting) && !catalogueEnd.hidden)
      void loadCatalogue()
  },
  { rootMargin: '0px 0px 400px 0px' },
)
async function loadCatalogue() {
  if (catalogueLoading) return
  catalogueLoading = true
  const initialLoad = page === 0
  if (initialLoad) setPageLoading(true)
  catalogueObserver.unobserve(catalogueEnd)
  catalogueEnd.hidden = true
  $('load-more').hidden = initialLoad
  $('load-more').textContent = '正在加载…'
  $('load-more').disabled = true
  const params = new URLSearchParams({ page: String(page) })
  if (author) params.set('author', author)
  try {
    const { games } = await readJson(`/api/games?${params}`)
    if (page === 0) paintFeatures(games)
    for (const [index, item] of games.entries()) {
      const card = $('game-card').content.cloneNode(true)
      card.querySelector('.card-play').href =
        `/g/${encodeURIComponent(item.projectId)}`
      card.querySelector('h3').textContent = item.title
      card.querySelector('.card-image').src = coverFor(item)
      if (item.coverUrl) card.querySelector('.card-art').classList.add('has-cover')
      card
        .querySelector('.game-card')
        .style.setProperty('--enter-delay', `${Math.min(index, 8) * 35}ms`)
      $('game-grid').append(card)
    }
    if (author && page === 0 && games.length) {
      catalogueAuthor = games[0].authorName
      $('catalogue-title').textContent =
        user?.id === author ? '我的发布' : `${catalogueAuthor} 的游戏`
    }
    $('catalogue-status').hidden = $('game-grid').children.length > 0
    $('catalogue-status').textContent = author
      ? '这里还没有公开发布的游戏。'
      : '好游戏正在路上。创作者发布后，就会出现在这里。'
    catalogueEnd.hidden = games.length < 24
    $('load-more').hidden = true
    page++
  } catch (error) {
    $('catalogue-status').hidden = false
    $('catalogue-status').textContent = error.message
    $('load-more').hidden = false
    $('load-more').textContent = '重试'
  } finally {
    catalogueLoading = false
    if (initialLoad) setPageLoading(false)
    $('load-more').disabled = false
    if (!catalogueEnd.hidden) catalogueObserver.observe(catalogueEnd)
  }
}
$('load-more').addEventListener('click', () => {
  void loadCatalogue()
})
function showError(message) {
  clearTimeout(loadTimer)
  $('load-state').textContent = message
  $('load-state').hidden = false
  $('load-state').setAttribute('role', 'alert')
}
function loadFrame() {
  if (!game) return
  clearTimeout(loadTimer)
  $('load-state').textContent = '正在连接游戏…'
  $('load-state').hidden = false
  $('load-state').setAttribute('role', 'status')
  $('audio-button').hidden = true
  $('audio-button').setAttribute('aria-pressed', 'false')
  $('game-frame').src = game.gameUrl
  loadTimer = setTimeout(
    () => showError('连接时间较长，请尝试重新加载。'),
    15000,
  )
}
async function loadGame() {
  setPageLoading(true)
  try {
    game = await readJson(
      deploymentId
        ? `/api/deployments/${deploymentId}`
        : `/api/games/${projectId}`,
    )
    gameOrigin = new URL(game.gameUrl).origin
    const gameUrl = new URL(game.gameUrl)
    // Loopback HTTP supports local development; remote game delivery requires HTTPS.
    const loopback = ['localhost', '127.0.0.1', '[::1]']
    const localGame =
      location.protocol === 'http:' &&
      loopback.includes(location.hostname) &&
      gameUrl.protocol === 'http:' &&
      loopback.includes(gameUrl.hostname)
    if (
      gameOrigin === location.origin ||
      (gameUrl.protocol !== 'https:' && !localGame)
    )
      throw Error('游戏地址无效。')
    $('game-title').textContent = game.title
    $('game-frame').title = game.title
    document.title = portalTitle(game.title)
    $('game-author').textContent = `由 ${game.authorName} 创作`
    $('game-author').href = authorUrl(game.authorId)
    const description = typeof game.description === 'string' ? game.description.trim() : ''
    renderPublicationDescription(description, game.title)
    $('game-description').hidden = !description
    $('share-button').disabled = false
    $('retry-button').disabled = false
    loadFrame()
  } catch (error) {
    showError(error.message)
    $('retry-button').disabled = false
  } finally {
    setPageLoading(false)
  }
}
const playerMenu = $('player-menu')
const playerMenuButton = $('player-menu-button')
function closePlayerMenu() {
  playerMenu.open = false
  if (playerMenu.querySelector('.player-actions').contains(document.activeElement))
    playerMenuButton.focus({ preventScroll: true })
}
playerMenu.addEventListener('pointerenter', event => {
  if (event.pointerType === 'mouse') playerMenu.open = true
})
playerMenu.addEventListener('pointerleave', event => {
  if (event.pointerType === 'mouse') closePlayerMenu()
})
playerMenuButton.addEventListener('click', event => {
  // Hover has already opened it; mouse clicks should not immediately collapse it.
  // Touch and keyboard retain the native disclosure toggle.
  if (event.pointerType === 'mouse') {
    event.preventDefault()
    playerMenu.open = true
  }
})
playerMenu.addEventListener('click', event => {
  if (event.target.closest('.player-actions button')) closePlayerMenu()
})
playerMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape' && playerMenu.open) {
    event.preventDefault()
    event.stopPropagation()
    closePlayerMenu()
    playerMenuButton.focus({ preventScroll: true })
  }
})
playerMenu.addEventListener('focusout', event => {
  if (!playerMenu.contains(event.relatedTarget)) playerMenu.open = false
})
document.addEventListener('pointerdown', event => {
  if (!playerMenu.contains(event.target)) playerMenu.open = false
})
window.addEventListener('blur', closePlayerMenu)
$('retry-button').addEventListener('click', () => {
  game ? loadFrame() : void loadGame()
})
$('game-frame').addEventListener('load', () => {
  if (!gameOrigin) return
  // A cross-origin iframe load event is not proof that a game is playable.
  // Keep recovery controls available and never report verified game readiness.
  clearTimeout(loadTimer)
  $('load-state').hidden = true
})
$('game-frame').addEventListener('error', () =>
  showError('游戏页面连接失败，请尝试重新加载。'),
)
function updateFullscreen() {
  const active =
    document.fullscreenElement === $('player') ||
    $('player').classList.contains('is-expanded')
  $('fullscreen-button').setAttribute('aria-pressed', String(active))
  $('fullscreen-button').setAttribute(
    'aria-label',
    active ? '退出全屏' : '全屏',
  )
}
$('fullscreen-button').addEventListener('click', async () => {
  const player = $('player')
  if (document.fullscreenElement === player)
    await document.exitFullscreen().catch(() => {})
  else if (player.classList.contains('is-expanded'))
    player.classList.remove('is-expanded')
  else if (player.requestFullscreen)
    await player
      .requestFullscreen()
      .catch(() => player.classList.add('is-expanded'))
  else player.classList.add('is-expanded')
  updateFullscreen()
})
document.addEventListener('fullscreenchange', updateFullscreen)
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('player').classList.remove('is-expanded')
    updateFullscreen()
  }
})
window.addEventListener('message', event => {
  if (
    !gameOrigin ||
    event.origin !== gameOrigin ||
    event.source !== $('game-frame').contentWindow
  )
    return
  if (
    event.data?.type === 'beegame:audio-control-ready' &&
    event.data.version === 1
  )
    $('audio-button').hidden = false
})
$('audio-button').addEventListener('click', () => {
  if ($('audio-button').hidden || !gameOrigin) return
  const muted = $('audio-button').getAttribute('aria-pressed') !== 'true'
  $('game-frame').contentWindow?.postMessage(
    { type: 'beegame:set-muted', version: 1, muted },
    gameOrigin,
  )
  $('audio-button').setAttribute('aria-pressed', String(muted))
  $('audio-button').setAttribute('aria-label', muted ? '开启声音' : '静音')
})
let shareTimer
$('close-share').addEventListener('click', () => {
  clearTimeout(shareTimer)
  $('share-status').textContent = ''
  $('share-url').hidden = true
  playerMenuButton.focus()
})
$('share-button').addEventListener('click', async () => {
  if (!game) return
  clearTimeout(shareTimer)
  $('share-status').textContent = ''
  $('share-url').hidden = true
  const url = new URL(
    `/g/${encodeURIComponent(game.projectId)}`,
    location.origin,
  ).href
  try {
    if (navigator.share) await navigator.share({ title: portalTitle(game.title), text: portalDescription(game), url })
    else {
      await navigator.clipboard.writeText(url)
      $('share-status').textContent = '游戏链接已复制。'
      shareTimer = setTimeout(() => {
        $('share-status').textContent = ''
      }, 3500)
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    $('share-url').hidden = false
    $('share-url').value = url
    $('share-url').select()
    $('share-status').textContent = '请选择并复制这个固定链接。'
  }
})
void initializeAuth()
if (isGame) void loadGame()
else void loadCatalogue()
