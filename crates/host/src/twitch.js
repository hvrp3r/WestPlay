// WestPlay: Twitch's site (twitch.tv), hidden, as the engine of the cab's Twitch app (twitch.rs). Run before
// Twitch's own scripts, after cab_sound.js. The host takes the page where the app asks: a list of channels live
// (the player's followed ones, or the most watched), whose cards this script reads and tells, or a channel,
// whose stream it shows, alone, filling the page, and plays, pauses and sets the volume of as asked, telling the
// host what plays. And whether the page is signed in; nothing else of the account.
//
// Twitch's site as read on 2026-10-27: a list's cards are `article`s, each with links to its channel
// (`/<login>`), `preview-card-channel-link` (the stream's title in its `h4`, the channel's name in a `p`),
// `preview-card-game-link`, `preview-card-image-link` ("LIVE 17.6K viewers") and its pictures; a channel's page
// has its player (`video-player`), `stream-title`, `stream-game-link` and `animated-channel-viewers-count`; a
// page not signed in has `login-button`.
;(() => {
  if (window.top !== window || window.westplayTwitch) return
  window.westplayTwitch = true
  const post = (message) => window.chrome?.webview?.postMessage(message)

  // Only the stream, filling the page, all of it: a copy, live (its picture captured), outside Twitch's page
  // (as tiktok.js's, whose reasons hold here too).
  const STYLE = `
    html, body { background: #000 !important; overflow: hidden !important; }
    body * { visibility: hidden !important; }
    #westplay-mirror {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      object-fit: contain;
      background: #000;
      z-index: 2147483647;
      pointer-events: none;
    }`
  const addStyle = () => {
    if (document.getElementById('westplay-twitch')) return
    const style = document.createElement('style')
    style.id = 'westplay-twitch'
    style.textContent = STYLE
    ;(document.head ?? document.documentElement)?.append(style)
  }
  addStyle()
  document.addEventListener('DOMContentLoaded', addStyle)

  const text = (root, selector) => (root?.querySelector(selector)?.textContent ?? '').trim()
  // An image of Twitch's own image host, or none.
  const image = (url) => (typeof url === 'string' && url.startsWith('https://static-cdn.jtvnw.net/') ? url : null)
  // Which page this is: a list (`following`, `popular`), or a channel (its login).
  const page = () => {
    const path = location.pathname.replace(/\/+$/, '')
    if (path === '/directory/following/live' || path === '/directory/following') return { list: 'following' }
    if (path === '/directory/all') return { list: 'popular' }
    const login = path.match(/^\/([A-Za-z0-9_]{1,25})$/)?.[1]
    return login ? { channel: login.toLowerCase() } : {}
  }

  // A list's card, as the app shows it.
  const card = (article) => {
    const login = [...article.querySelectorAll('a[href]')]
      .map((link) => link.getAttribute('href').match(/^\/([A-Za-z0-9_]{1,25})$/)?.[1])
      .find(Boolean)
    if (!login) return null
    const links = article.querySelectorAll('[data-a-target="preview-card-channel-link"]')
    const pictures = [...article.querySelectorAll('img')].map((img) => img.src)
    // Its texts each apart, from its nodes (a hidden element's `innerText` is empty: its page is hidden).
    const stat = [...(article.querySelector('[data-a-target="preview-card-image-link"]')?.querySelectorAll('*') ?? [])]
      .filter((element) => element.children.length === 0)
      .map((element) => element.textContent)
      .join('\n')
    return {
      login: login.toLowerCase(),
      name: links[1]?.querySelector('p[title]')?.getAttribute('title') ?? login,
      title: links[0]?.querySelector('[title]')?.getAttribute('title') ?? text(links[0], 'h4'),
      game: text(article, '[data-a-target="preview-card-game-link"]'),
      viewers: stat.split('\n').map((line) => line.trim()).find((line) => /\d/.test(line)) ?? '',
      avatar: image(pictures.find((src) => src.includes('/jtv_user_pictures/'))),
      thumbnail: image(pictures.find((src) => src.includes('/previews-ttv/'))),
    }
  }

  // What the player asked for: playing or paused, and the volume (0 to 1), held to as Twitch's player sets its own.
  let wanted = 'play'
  let volume = 0.8
  const player = () =>
    document.querySelector('[data-a-target="video-player"] video') ?? document.querySelector('video')

  // The truck's own speakers (cab_sound.js), playing the stream's sound.
  const cab = window.westplayCabSound?.(() => (page().channel ? player() : null), post)

  const run = (command) => {
    const video = player()
    switch (command.action) {
      case 'play':
        wanted = 'play'
        video?.play().catch(() => {})
        break
      case 'pause':
        wanted = 'pause'
        video?.pause()
        break
      case 'volume':
        volume = Math.min(1, Math.max(0, command.percent / 100))
        break
      // The player chose to watch past Twitch's warning on the stream's content (its own button).
      case 'acceptGate':
        document
          .querySelector(
            '[data-a-target="player-overlay-mature-accept"], [data-a-target="content-classification-gate-overlay-start-watching-button"]',
          )
          ?.click()
        break
      case 'speakers':
        cab?.speakers(command.speakers)
        break
      case 'outside':
        cab?.outside(command.on, command.distance)
        break
      case 'head':
        cab?.head(command)
        break
      case 'equalizer':
        cab?.equalizer(command)
        break
      case 'spectrum':
        cab?.spectrum(command.on)
        break
    }
  }
  window.chrome?.webview?.addEventListener('message', (event) => run(event.data))
  // Here: the host sends what it held back for this page.
  post({ ready: true })

  // The copy of the stream: muted (the sound is the stream's own), on the page's root, outside Twitch's.
  const mirror = document.createElement('video')
  mirror.id = 'westplay-mirror'
  mirror.muted = true
  mirror.autoplay = true
  mirror.playsInline = true
  let mirrored = null
  let mirroredStream = null
  const showCopy = (video) => {
    if (!mirror.isConnected && document.documentElement) document.documentElement.append(mirror)
    // Captured again when the player's element or its stream changes (Twitch's player swaps its source for an ad).
    const tracks = mirroredStream?.getVideoTracks() ?? []
    const ended = tracks.length === 0 || tracks.every((track) => track.readyState === 'ended')
    if (video !== mirrored || (video && ended)) {
      mirrored = video
      try {
        mirroredStream = video?.captureStream?.() ?? null
      } catch {
        mirroredStream = null
      }
      mirror.srcObject = mirroredStream
    }
    if (mirror.srcObject && mirror.paused) mirror.play().catch(() => {})
  }

  const loadedAt = Date.now()
  let lastList = ''
  let last = ''
  let lastAt = 0
  setInterval(() => {
    addStyle()
    const where = page()
    const loginButton = document.querySelector('[data-a-target="login-button"]')
    const nav = document.querySelector('[data-a-target="user-menu-toggle"]')

    // A list: its cards, told as they change (and once, empty or not, after a few seconds: a list with none).
    if (where.list) {
      const channels = [...document.querySelectorAll('article')].map(card).filter(Boolean).slice(0, 60)
      const told = JSON.stringify(channels)
      if ((told !== lastList && channels.length > 0) || (lastList === '' && Date.now() - loadedAt > 5000)) {
        lastList = told
        post({ list: { which: where.list, channels } })
      }
    }

    const video = where.channel ? player() : null
    showCopy(video)
    if (video) {
      if (Math.abs(video.volume - volume) > 0.01) video.volume = volume
      if (video.muted !== (volume === 0)) video.muted = volume === 0
      if (wanted === 'play' && video.paused && video.readyState >= 2) video.play().catch(() => {})
      if (wanted === 'pause' && !video.paused) video.pause()
    }
    cab?.tick()

    const report = {
      loaded: !!nav || !!loginButton,
      signedIn: !!nav && !loginButton,
      channel: where.channel ?? null,
      name: where.channel ? text(document, 'h1') : '',
      title: where.channel ? text(document, '[data-a-target="stream-title"]') : '',
      game: where.channel ? text(document, '[data-a-target="stream-game-link"]') : '',
      viewers: where.channel ? text(document, '[data-a-target="animated-channel-viewers-count"]') : '',
      live: !!where.channel && !!document.querySelector('[data-a-target="animated-channel-viewers-count"]'),
      gate: !!document.querySelector(
        '[data-a-target="player-overlay-mature-accept"], [data-a-target="content-classification-gate-overlay-start-watching-button"]',
      ),
      playing: !!video && !video.paused,
      cabLevel: cab?.level() ?? null,
    }
    const changed = JSON.stringify({ ...report, cabLevel: undefined })
    const now = Date.now()
    if (changed !== last || now - lastAt >= 2000) {
      last = changed
      lastAt = now
      post(report)
    }
  }, 300)
})()
