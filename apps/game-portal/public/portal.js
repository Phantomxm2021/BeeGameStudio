import { playerPageWidth } from '../src/player-layout'
import i18n, { t } from '../src/player-i18n'
import { trackPortalEvent, observeBanner } from './analytics'
import { portalTitle, portalDescription } from '../src/seo'
import { renderPublicationDescription } from '../../frontend/src/entrypoints/portalDescription'
const $ = id => document.getElementById(id)
function setTranslatedText(id, key) {
  const node = $(id)
  node.dataset.i18n = key
  node.textContent = t(key)
}
const projectId = /^\/g\/([A-Za-z0-9_-]{1,128})\/?$/.exec(
  location.pathname,
)?.[1]
const deploymentId =
  /^\/deployments\/([A-Za-z0-9_-]{1,128})\/files\/index\.html$/.exec(
    location.pathname,
  )?.[1]
const isGame = Boolean(projectId || deploymentId)
document.body.classList.toggle('play-page', isGame)
$('catalogue').hidden = isGame
$('game-page').hidden = !isGame
function setPageLoading(loading) {
  $('main').classList.toggle('is-loading', loading)
  $('main').setAttribute('aria-busy', String(loading))
  $('page-loading').hidden = !loading
  document.querySelector('.site-header').inert = loading
}
const author = new URLSearchParams(location.search).get('author')
const catalogueQuery = new URLSearchParams(location.search).get('q')?.trim().slice(0, 120) || ''
$('search-games').value = catalogueQuery
$('clear-search').hidden = !catalogueQuery
$('home-title').hidden = Boolean(author)
$('catalogue-heading').hidden = !author && !catalogueQuery
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
  const slides = [...featureTrack.children]
  const position = slides.length > 1 ? featureTrack.scrollLeft / (slides[0].getBoundingClientRect().width + 20) : 0
  const current = Math.max(0, Math.min(slides.length - 1, Math.round(position)))
  for (const [index, dot] of [...featureDots.children].entries()) {
    dot.style.setProperty('--feature-distance', String(index - position))
    dot.setAttribute('aria-selected', String(index === current))
    dot.tabIndex = index === current ? 0 : -1
    dot.setAttribute('aria-label', t('viewFeatured', { title: dot.dataset.title }))
    slides[index].style.setProperty('--feature-distance', String(index - position))
    slides[index].setAttribute('aria-hidden', String(index !== current))
    slides[index].querySelector('a').tabIndex = index === current ? 0 : -1
    slides[index].querySelector('a').setAttribute('aria-label', t('playFeatured', { title: dot.dataset.title }))
  }
  featureDots.style.setProperty('--feature-progress', String(featureElapsed / featureHoldDuration))
  featurePlayback.dataset.state = featureEnded ? 'ended' : featurePaused ? 'paused' : 'playing'
  featurePlayback.setAttribute('aria-label', t(featureEnded ? 'featureReplay' : featurePaused ? 'featurePlay' : 'featurePause'))
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
for (const event of ['pointerdown', 'focusin'])
  featureTrack.addEventListener(event, pauseFeatureInteraction, { passive: true })
featureTrack.addEventListener('wheel', event => {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) pauseFeatureInteraction()
}, { passive: true })
featureTrack.addEventListener('scroll', () => {
  if (featureTransition || !featureTrack.children.length) return
  const nearest = [...featureTrack.children].reduce((best, _, index) =>
    Math.abs(featureOffset(index) - featureTrack.scrollLeft) < Math.abs(featureOffset(best) - featureTrack.scrollLeft) ? index : best, 0)
  if (nearest !== featureIndex) {
    featureIndex = nearest
    featureElapsed = 0
    featureEnded = false
  }
  updateCarousel()
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
    updateCarousel()
    updateFeatureVisibility()
  }
}).observe(featureTrack)
// The reference uses these spring responses and stagger times for its two control bubbles.
// Sample the bounded entrance into native animations; no extra persistent frame loop.
function playFeatureControlsIntro() {
  if (reducedMotion.matches) return
  const controls = $('featured').querySelector('.carousel-controls')
  const dots = $('featured').querySelector('.feature-dots-shell')
  const width = dots.getBoundingClientRect().width
  function spring(from, to, time, delay, frequency, ratio) {
    const elapsed = Math.max(0, time - delay)
    const envelope = Math.exp(-frequency * ratio * elapsed)
    const damped = frequency * Math.sqrt(1 - ratio * ratio)
    const response = ratio === 1 ? (1 + frequency * elapsed) * envelope
      : envelope * (Math.cos(damped * elapsed) + frequency * ratio / damped * Math.sin(damped * elapsed))
    return to + (from - to) * response
  }
  function animate(element, sample, final) {
    const frames = Array.from({ length: 121 }, (_, index) => index === 120 ? final : sample(index / 60))
    const animation = element.animate(frames, { duration: 2000, fill: 'both' })
    animation.onfinish = () => animation.cancel()
  }
  animate(controls, time => ({ transform: `translateY(${spring(180, 0, time, .03, 10, .4)}px)` }), { transform: 'none' })
  animate(controls.querySelector('.carousel-seed'), time => ({
    width: `${spring(30, 56, time, .05, 10, .4)}px`, height: `${spring(80, 56, time, .15, 10, .4)}px`,
    transform: `translateX(${spring(-15, -28, time, .05, 10, .4)}px) scale(${spring(1.3, .8, time, .02, 2 * Math.PI / .5, 1)})`,
    opacity: time >= .02 && time < .52 ? 1 : 0,
  }), { opacity: 0 })
  animate(dots, time => ({ transform: `translateX(${spring(36, 0, time, .5, 10, 1)}px)` }), { transform: 'none' })
  animate(dots.querySelector('.carousel-backdrop'), time => ({
    width: `${spring(40, width, time, .5, 10, .5)}px`, height: `${spring(36, 56, time, .7, 10, .5)}px`,
    transform: `translate(-50%,-50%) scale(${spring(1.3, 1, time, .3, 2 * Math.PI / .3, 1)})`,
    '--carousel-alpha': spring(0, 1, time, 1, 10, 1),
  }), { width: '100%', height: '56px', transform: 'translate(-50%,-50%)', '--carousel-alpha': 1 })
  animate(featurePlayback, time => ({ transform: `translateX(${spring(-width / 2 - 8, 0, time, .54, 10, 1)}px)` }), { transform: 'none' })
  animate(featurePlayback.querySelector('.carousel-backdrop'), time => ({
    width: `${spring(80, 56, time, .7, 10, .5)}px`, height: `${spring(36, 56, time, .7, 10, .5)}px`,
    transform: `translate(-50%,-50%) scale(${spring(0, 1, time, .54, 2 * Math.PI / .65, 1)})`,
    '--carousel-alpha': spring(0, 1, time, 1, 10, 1),
  }), { width: '100%', height: '56px', transform: 'translate(-50%,-50%)', '--carousel-alpha': 1 })
  animate(featureDots, time => ({ '--feature-intro': spring(0, 1, time, .74, Math.sqrt(200), 20 / (2 * Math.sqrt(200))) }), { '--feature-intro': 1 })
  for (const [index, dot] of [...featureDots.children].entries())
    animate(dot.querySelector('.feature-dot-track'), time => ({ transform: `translateX(${spring(36, 0, time, .74 + .02 * index, Math.sqrt(200), 20 / (2 * Math.sqrt(200)))}px)` }), { transform: 'none' })
}
function updateFeatureVisibility() {
  const rect = featureTrack.getBoundingClientRect()
  featureVisible = !$('featured').hidden && rect.top <= innerHeight - rect.height * .6 && $('featured').getBoundingClientRect().bottom >= innerHeight * .75
  if (featureVisible) {
    if (!$('featured').classList.contains('controls-ready') && featureTrack.children.length > 1) {
      $('featured').classList.add('controls-ready')
      playFeatureControlsIntro()
    }
    scheduleFeatureFrame()
  } else suspendFeature()
}
new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) $('featured').classList.add('has-entered')
  updateFeatureVisibility()
}, { threshold: .15 }).observe(featureTrack)
window.addEventListener('scroll', updateFeatureVisibility, { passive: true })
window.addEventListener('resize', updateFeatureVisibility)
featureDots.addEventListener('keydown', event => {
  const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? featureDots.children.length - 1 : direction ? featureIndex + direction : -1
  if (next < 0 || next >= featureDots.children.length) return
  event.preventDefault()
  scrollFeature(next, true)
  featureDots.children[next].focus({ preventScroll: true })
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendFeature()
  else scheduleFeatureFrame()
})
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    for (const animation of $('featured').getAnimations({ subtree: true })) animation.finish()
    pauseFeatureInteraction()
    if (featureTrack.children.length) featureTrack.scrollLeft = featureOffset(featureIndex)
  }
})
function paintFeatures(games) {
  for (const [index, item] of games.slice(0, 5).entries()) {
    const fragment = $('feature-card').content.cloneNode(true)
    const slide = fragment.querySelector('.feature-slide')
    slide.id = `featured-game-${index}`
    slide.style.setProperty('--feature-index', String(index))
    slide.setAttribute('aria-labelledby', `featured-tab-${index}`)
    observeBanner(slide, item.projectId)
    const link = fragment.querySelector('.feature-link')
    link.addEventListener('click', event => {
      if (index !== featureIndex || featureTransition) { event.preventDefault(); scrollFeature(index, true); return }
      void trackPortalEvent('banner_click', item.projectId)
    })
    link.href = `/g/${encodeURIComponent(item.projectId)}`
    fragment.querySelector('.feature-cover').src = coverFor(item)
    const caption = fragment.querySelector('.feature-caption')
    caption.textContent = item.featuredCaption || ''
    caption.hidden = !caption.textContent
    link.classList.toggle('has-caption', !caption.hidden)
    featureTrack.append(fragment)
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.id = `featured-tab-${index}`
    dot.dataset.title = item.title
    dot.setAttribute('role', 'tab')
    dot.setAttribute('aria-controls', slide.id)
    dot.style.setProperty('--feature-index', String(index))
    dot.innerHTML = '<span class="feature-dot-track"><span class="feature-dot-fill"></span></span>'
    dot.addEventListener('click', () => scrollFeature(index, true))
    featureDots.append(dot)
  }
  $('featured').hidden = games.length === 0
  $('featured').querySelector('.carousel-shell').hidden = games.length < 2
  $('featured').classList.toggle('is-single', games.length === 1)
  updateCarousel()
  updateFeatureVisibility()
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
        ? t('unavailable')
        : t('failed'),
    )
  return response.json()
}
function authorUrl(id) {
  return `/?author=${encodeURIComponent(id)}`
}
function updateCatalogueHeading() {
  if (catalogueQuery) $('catalogue-title').textContent = `${t('searchResults')} · ${catalogueQuery}`
  else if (author) $('catalogue-title').textContent = user?.id === author ? t('releases')
    : catalogueAuthor ? t('authorGames', { name: catalogueAuthor }) : t('creatorGames')
}
function paintAccount() {
  for (const listener of accountListeners) listener(user || null)
  updateCatalogueHeading()
}
async function initializeAuth() {
  try {
    const config = await readJson('/api/config')
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      accountError = t('accountUnavailable')
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
      if (/^\/(?:admin\/?|g\/[A-Za-z0-9_-]+\/?|\?author=[A-Za-z0-9_-]+)$/.test(returnTo))
        location.replace(returnTo)
    }
  } catch {
    accountError = t('accountFailed')
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
export async function signOutPortalAccount() {
  try {
    await auth?.clearSupabaseSession()
    user = null
    paintAccount()
  } catch { window.alert(t('logoutFailed')) }
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
    $('login-error').textContent = error.message || t('loginFailed')
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
      $('login-error').textContent = error.message || t('loginFailed')
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
  setTranslatedText('load-more', 'loading')
  $('load-more').disabled = true
  const params = new URLSearchParams({ page: String(page) })
  if (author) params.set('author', author)
  if (catalogueQuery) params.set('q', catalogueQuery)
  try {
    const { games } = await readJson(`/api/games?${params}`)
    if (page === 0 && !author && !catalogueQuery) {
      // Recommendations are optional; their failure must not hide the catalogue.
      void readJson('/api/featured').then(featured => paintFeatures(featured.games)).catch(() => { $('featured').hidden = true })
    }
    for (const [index, item] of games.entries()) {
      const card = $('game-card').content.cloneNode(true)
      card.querySelector('.card-play').href =
        `/g/${encodeURIComponent(item.projectId)}`
      card.querySelector('h3').textContent = item.title
      const plays = card.querySelector('.play-count')
      plays.dataset.playCount = String(item.playCount || 0)
      plays.textContent = playCount(plays.dataset.playCount)
      card.querySelector('.card-image').src = coverFor(item)
      if (item.coverUrl) card.querySelector('.card-art').classList.add('has-cover')
      card
        .querySelector('.game-card')
        .style.setProperty('--enter-delay', `${Math.min(index, 8) * 35}ms`)
      $('game-grid').append(card)
    }
    if (author && page === 0 && games.length) {
      catalogueAuthor = games[0].authorName
      updateCatalogueHeading()
    }
    $('catalogue-status').hidden = $('game-grid').children.length > 0
    setTranslatedText('catalogue-status', catalogueQuery ? 'noResults' : author ? 'empty' : 'catalogueEmpty')
    catalogueEnd.hidden = games.length < 24
    $('load-more').hidden = true
    page++
  } catch (error) {
    $('catalogue-status').hidden = false
    setTranslatedText('catalogue-status', error.message === t('unavailable') ? 'unavailable' : 'failed')
    $('load-more').hidden = false
    setTranslatedText('load-more', 'retry')
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
function showLoadState(key) {
  const loading = key === 'connecting'
  const title = loading ? key : key === 'slow' ? 'slowTitle' : 'failedTitle'
  $('load-state').dataset.state = loading ? 'loading' : key === 'slow' ? 'slow' : 'error'
  $('load-state').setAttribute('role', loading ? 'status' : 'alert')
  $('load-title').dataset.i18n = title
  $('load-title').textContent = t(title)
  $('load-message').hidden = loading
  if (loading) {
    delete $('load-message').dataset.i18n
    $('load-message').textContent = ''
  } else {
    const message = key === 'failed' ? 'loadFailedHint' : key
    $('load-message').dataset.i18n = message
    $('load-message').textContent = t(message)
  }
  $('load-retry').hidden = loading
  $('load-state').hidden = false
}
function showError(key) {
  clearTimeout(loadTimer)
  showLoadState(key)
}
function loadFrame() {
  if (!game) return
  clearTimeout(loadTimer)
  showLoadState('connecting')
  $('audio-button').hidden = true
  $('audio-button').setAttribute('aria-pressed', 'false')
  $('game-frame').src = game.gameUrl
  loadTimer = setTimeout(() => showError('slow'), 15000)
}
async function loadGame() {
  setPageLoading(true)
  showLoadState('connecting')
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
      throw Error(t('invalid'))
    $('game-title').textContent = game.title
    $('game-play-count').textContent = playCount(game.playCount || 0)
    void trackPortalEvent('visit', game.projectId)
    $('game-frame').title = game.title
    document.title = portalTitle(game.title)
    $('game-author').textContent = t('author', { name: game.authorName })
    $('game-author').href = authorUrl(game.authorId)
    $('author-avatar').href = authorUrl(game.authorId)
    $('author-avatar').textContent = [...game.authorName].slice(0, 1).join('').toUpperCase()
    updateGameLanguage()
    void loadRelatedGames()
    const description = typeof game.description === 'string' ? game.description.trim() : ''
    renderPublicationDescription(description, game.title)
    $('game-description').hidden = !description
    $('share-button').disabled = false
    $('retry-button').disabled = false
    loadFrame()
  } catch (error) {
    game = undefined
    gameOrigin = ''
    const key = ['invalid', 'unavailable'].find(key => t(key) === error.message) || 'failed'
    showError(key)
    $('retry-button').disabled = false
  } finally {
    setPageLoading(false)
  }
}
function retryGame() {
  game ? loadFrame() : void loadGame()
}
$('retry-button').addEventListener('click', retryGame)
$('load-retry').addEventListener('click', retryGame)
$('game-frame').addEventListener('load', () => {
  if (!gameOrigin) return
  // A cross-origin iframe load event is not proof that a game is playable.
  // Keep recovery controls available and never report verified game readiness.
  clearTimeout(loadTimer)
  $('load-state').hidden = true
})
$('game-frame').addEventListener('error', () =>
  showError('failed'),
)
function updateFullscreen() {
  const active =
    document.fullscreenElement === $('player') ||
    $('player').classList.contains('is-expanded')
  $('fullscreen-button').setAttribute('aria-pressed', String(active))
  $('fullscreen-button').setAttribute(
    'aria-label',
    active ? t('exitFullscreen') : t('fullscreen'),
  )
}
$('exit-fullscreen').addEventListener('click', () => $('fullscreen-button').click())
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
  if (!game || event.source !== $('game-frame').contentWindow || event.origin !== gameOrigin ||
      event.data?.type !== 'beegame:play' || event.data.version !== 1) return
  const expected = /^\/deployments\/([^/]+)\/files\/index\.html$/.exec(new URL(game.gameUrl).pathname)?.[1]
  if (!expected || event.data.deploymentId !== expected) return
  void trackPortalEvent('play', game.projectId).then(result => {
    if (result && Number.isSafeInteger(result.playCount) && result.playCount >= 0) {
      game.playCount = result.playCount
      $('game-play-count').textContent = playCount(result.playCount)
    }
  })
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
  $('audio-button').setAttribute('aria-label', muted ? t('unmute') : t('mute'))
})
let shareTimer
$('close-share').addEventListener('click', () => {
  clearTimeout(shareTimer)
  $('share-status').textContent = ''
  $('share-url').hidden = true
  $('share-button').focus()
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
      $('share-status').textContent = t('copied')
      shareTimer = setTimeout(() => {
        $('share-status').textContent = ''
      }, 3500)
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    $('share-url').hidden = false
    $('share-url').value = url
    $('share-url').select()
    $('share-status').textContent = t('copyLink')
  }
})
function playCount(count) { return t(Number(count) === 1 && i18n.language === 'en' ? 'playOne' : 'plays', { count: Number(count).toLocaleString(i18n.language) }) }
function updateGameLanguage() {
  if (!game) return
  $('game-play-count').textContent = playCount(game.playCount || 0)
  $('game-author').textContent = game.authorName
  const published = new Date(game.publishedAt)
  $('game-published').textContent = Number.isNaN(published.getTime()) ? '' : published.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })
  if (!Number.isNaN(published.getTime())) $('game-published').dateTime = published.toISOString()
}
let relatedGames = []
async function loadRelatedGames() {
  setTranslatedText('related-status', 'loading')
  $('related-retry').hidden = true
  try {
    const response = await readJson('/api/games?page=0')
    relatedGames = response.games.filter(item => item.projectId !== game.projectId)
    paintRelatedGames()
  } catch {
    setTranslatedText('related-status', 'failed')
    $('related-retry').hidden = false
  }
}
function paintRelatedGames() {
  $('related-games').replaceChildren()
  for (const item of relatedGames) {
    const link = document.createElement('a')
    link.className = 'related-game'
    link.href = `/g/${encodeURIComponent(item.projectId)}`
    const image = document.createElement('img')
    image.src = coverFor(item)
    image.alt = ''
    image.loading = 'lazy'
    const copy = document.createElement('div')
    const title = document.createElement('h3')
    title.textContent = item.title
    const author = document.createElement('p')
    author.textContent = item.authorName
    const plays = document.createElement('p')
    plays.dataset.playCount = String(item.playCount || 0)
    plays.textContent = playCount(plays.dataset.playCount)
    copy.append(title, author, plays)
    link.append(image, copy)
    $('related-games').append(link)
  }
  if ($('related-games').children.length) {
    delete $('related-status').dataset.i18n
    $('related-status').textContent = ''
  } else setTranslatedText('related-status', 'empty')
}
$('related-retry').addEventListener('click', () => void loadRelatedGames())
function updateTheater() {
  const active = document.body.classList.contains('theater-mode')
  $('theater-button').setAttribute('aria-pressed', String(active))
  $('theater-button').setAttribute('aria-label', t(active ? 'defaultView' : 'theater'))
  const width = document.querySelector('.site-content').clientWidth
  document.documentElement.style.setProperty('--play-page-width', `${playerPageWidth(width, innerHeight, active)}px`)
}
$('theater-button').addEventListener('click', () => {
  document.body.classList.toggle('theater-mode')
  updateTheater()
})
window.addEventListener('resize', updateTheater)
new ResizeObserver(updateTheater).observe(document.querySelector('.site-content'))
const searchInput = $('search-games')
let searchTimer, searchController, searchMatches = [], searchActive = -1
let searchState = 'searchPrompt'
function closeSearch() {
  clearTimeout(searchTimer)
  searchController?.abort()
  $('search-panel').hidden = true
  searchInput.setAttribute('aria-expanded', 'false')
  searchInput.removeAttribute('aria-activedescendant')
  searchActive = -1
}
function paintSearch() {
  $('search-results').replaceChildren()
  $('search-status').textContent = searchState ? t(searchState) : ''
  $('search-retry').hidden = searchState !== 'searchFailed'
  const query = searchInput.value.trim()
  $('search-all').hidden = !query || searchState === 'loading' || searchState === 'searchFailed'
  $('search-all').href = `/?q=${encodeURIComponent(query)}`
  for (const [index, item] of searchMatches.entries()) {
    const link = document.createElement('a')
    link.className = 'search-result'
    link.id = `search-result-${index}`
    link.href = `/g/${encodeURIComponent(item.projectId)}`
    link.setAttribute('role', 'option')
    link.setAttribute('aria-selected', String(index === searchActive))
    link.tabIndex = -1
    const copy = document.createElement('span')
    copy.className = 'search-result-copy'
    const title = document.createElement('strong')
    title.textContent = item.title
    const author = document.createElement('small')
    author.textContent = item.authorName
    copy.append(title, author)
    link.append(copy)
    link.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>')
    $('search-results').append(link)
  }
}
function openSearch() {
  $('search-panel').hidden = false
  searchInput.setAttribute('aria-expanded', 'true')
  paintSearch()
}
async function runSearch() {
  clearTimeout(searchTimer)
  searchController?.abort()
  const query = searchInput.value.trim()
  searchMatches = []
  searchActive = -1
  searchInput.removeAttribute('aria-activedescendant')
  searchState = query ? 'loading' : 'searchPrompt'
  $('clear-search').hidden = !searchInput.value
  openSearch()
  if (!query) return
  const controller = new AbortController()
  searchController = controller
  try {
    const response = await fetch(`/api/games?${new URLSearchParams({ q: query })}`, { signal: controller.signal })
    if (!response.ok) throw Error('Search unavailable')
    const data = await response.json()
    if (controller.signal.aborted) return
    searchMatches = data.games.slice(0, 8)
    searchState = searchMatches.length ? '' : 'noResults'
  } catch (error) {
    if (controller.signal.aborted) return
    searchState = 'searchFailed'
  }
  paintSearch()
}
function scheduleSearch(event) {
  clearTimeout(searchTimer)
  searchController?.abort()
  searchMatches = []
  searchActive = -1
  searchInput.removeAttribute('aria-activedescendant')
  $('clear-search').hidden = !searchInput.value
  searchState = searchInput.value.trim() ? 'loading' : 'searchPrompt'
  openSearch()
  if (!event.isComposing) searchTimer = setTimeout(() => void runSearch(), 250)
}
searchInput.addEventListener('input', scheduleSearch)
searchInput.addEventListener('compositionend', scheduleSearch)
searchInput.addEventListener('focus', () => void runSearch())
searchInput.addEventListener('keydown', event => {
  if (event.isComposing) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); return }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && searchMatches.length) {
    event.preventDefault()
    searchActive = (searchActive + (event.key === 'ArrowDown' ? 1 : -1) + searchMatches.length) % searchMatches.length
    openSearch()
    searchInput.setAttribute('aria-activedescendant', `search-result-${searchActive}`)
    $(`search-result-${searchActive}`).scrollIntoView({ block: 'nearest' })
  }
})
$('clear-search').addEventListener('click', () => {
  searchInput.value = ''
  searchInput.focus()
  void runSearch()
})
$('search-retry').addEventListener('click', () => void runSearch())
$('game-search').addEventListener('submit', event => {
  event.preventDefault()
  if (searchActive >= 0) location.assign(`/g/${encodeURIComponent(searchMatches[searchActive].projectId)}`)
  else if (searchInput.value.trim()) location.assign(`/?q=${encodeURIComponent(searchInput.value.trim())}`)
})
document.addEventListener('pointerdown', event => { if (!$('game-search').contains(event.target)) closeSearch() })
$('game-search').addEventListener('focusout', event => { if (!$('game-search').contains(event.relatedTarget)) closeSearch() })
document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '/') { event.preventDefault(); $('search-games').focus() }
  if (isGame && event.key.toLowerCase() === 't') { event.preventDefault(); $('theater-button').click() }
  if (event.key === 'Escape') closeSearch()
})
const languageNames = { en: 'English', zh: '简体中文', 'zh-TW': '繁體中文', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español', it: 'Italiano', pt: 'Português' }
for (const [value, label] of Object.entries(languageNames)) $('portal-language').add(new Option(label, value))
$('portal-language').addEventListener('change', () => void i18n.changeLanguage($('portal-language').value))
function updateLanguage() {
  document.documentElement.lang = i18n.language
  $('portal-language').value = i18n.language
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const attribute of ['aria-label', 'placeholder', 'aria-roledescription']) for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`)))
  for (const node of document.querySelectorAll('[data-play-count]')) node.textContent = playCount(node.dataset.playCount)
  updateGameLanguage()
  updateCarousel()
  updateFullscreen()
  updateTheater()
  $('audio-button').setAttribute('aria-label', t($('audio-button').getAttribute('aria-pressed') === 'true' ? 'unmute' : 'mute'))
  if (!$('search-panel').hidden) paintSearch()
  updateCatalogueHeading()
  if (!isGame) document.title = `${t('homeTitle')} | Bee Game Studio（BGS）`
}
i18n.on('languageChanged', updateLanguage)
updateLanguage()
void initializeAuth()
if (isGame) void loadGame()
else void loadCatalogue()
