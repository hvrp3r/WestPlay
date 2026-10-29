// WestPlay: TikTok's page (tiktok.com's For You), hidden, as the engine of the cab's TikTok app (tiktok.rs). Run
// before TikTok's own scripts, after cab_sound.js. Everything of TikTok's page is hidden but the video playing,
// which fills the page; the cab's app has its own controls, and this script carries them out (play, pause, next,
// previous, like, volume) and tells the host what plays: the video's id, its author, text and sound, its counts,
// and whether the page is signed in. Nothing else of the account.
//
// TikTok's page as read on 2026-10-27: each video of the feed an `article[data-scroll-index]`, its video in
// `#xgwrapper-<n>-<id>`, its texts and buttons marked `data-e2e` (`video-desc`, `video-author-avatar`,
// `like-icon`, `like-count`, `comment-count`); the feed's own arrows `feed-navigation-next` and `-prev`; a page
// not signed in has `top-login-button` (and soon asks to sign in over the feed).
;(() => {
  if (window.top !== window || window.westplayTikTok) return
  window.westplayTikTok = true
  const post = (message) => window.chrome?.webview?.postMessage(message)

  // Only the video playing, filling the page, all of it (bars where its shape isn't the page's). It's shown as a
  // copy, live (`#westplay-mirror`: its picture captured), outside TikTok's page: the feed moves its videos with a
  // transform as it goes from one to the next, and a video of its own laid over the page would go with them, off
  // the page (2026-10-27: most videos showed no picture). Only a video that can't be captured is shown itself.
  const STYLE = `
    html, body { background: #000 !important; overflow: hidden !important; }
    body * { visibility: hidden !important; }
    tiktok-cookie-banner { display: none !important; }
    #westplay-mirror {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      object-fit: contain;
      background: #000;
      z-index: 2147483647;
      pointer-events: none;
    }
    video.westplay-shown {
      visibility: visible !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      object-fit: contain !important;
      transform: none !important;
      background: #000 !important;
      z-index: 2147483647 !important;
    }`
  const addStyle = () => {
    if (document.getElementById('westplay-tiktok')) return
    const style = document.createElement('style')
    style.id = 'westplay-tiktok'
    style.textContent = STYLE
    ;(document.head ?? document.documentElement)?.append(style)
  }
  addStyle()
  document.addEventListener('DOMContentLoaded', addStyle)

  // The feed's videos, and the one playing: the one whose place is nearest the top of the page.
  const articles = () => [...document.querySelectorAll('article[data-scroll-index]')]
  const current = () => {
    let best = null
    let bestDistance = Infinity
    for (const article of articles()) {
      if (!article.querySelector('video')) continue
      const distance = Math.abs(article.getBoundingClientRect().top)
      if (distance < bestDistance) {
        best = article
        bestDistance = distance
      }
    }
    return best
  }
  const videoOf = (article) => article?.querySelector('video') ?? null
  const idOf = (article) => {
    const wrapper = article?.querySelector('[id^="xgwrapper-"]')
    const id = wrapper?.id.split('-').pop() ?? null
    return id && /^\d{6,25}$/.test(id) ? id : null
  }
  const text = (root, selector) => (root?.querySelector(selector)?.textContent ?? '').trim()

  // What the player asked for: playing or paused (a video coming next plays; paused, it stays paused), and the
  // volume (0 to 1), held to as TikTok's player sets its own. Paused until asked to play: a page loaded with the
  // app closed (opened only for the sign-in, or again once signed in) plays nothing, hidden; the app asks for
  // play as it opens, and the host tells a page loaded again what was asked last (tiktok.rs).
  let wanted = 'pause'
  let volume = 0.8
  let liked = null

  // Every video of the page but the copy shown (TikTok's feed has a video for each of its videos near the one
  // playing, and the one playing isn't always the one found playing a moment later, as the feed moves).
  const videos = () => [...document.querySelectorAll('video')].filter((video) => video !== mirror)
  const pauseAll = () => {
    for (const video of videos()) if (!video.paused) video.pause()
  }
  // Paused, a video of the feed that starts playing (TikTok's own, as its feed moves to the next) is paused as
  // it starts, not at the next pass.
  document.addEventListener(
    'play',
    (event) => {
      if (wanted === 'pause' && event.target instanceof HTMLVideoElement && event.target !== mirror) {
        event.target.pause()
      }
    },
    true,
  )

  // To the next video or back: the feed's own arrows, or, while they can't be pressed, the video brought up.
  const move = (step) => {
    const now = current()
    const button = document.querySelector(`[data-e2e="feed-navigation-${step > 0 ? 'next' : 'prev'}"]`)
    if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
      button.click()
    } else if (now) {
      const index = Number(now.dataset.scrollIndex) + step
      document.querySelector(`article[data-scroll-index="${index}"]`)?.scrollIntoView({ block: 'start' })
    }
    wanted = 'play'
  }

  // The truck's own speakers (cab_sound.js), playing the video's sound.
  const cab = window.westplayCabSound?.(() => videoOf(current()), post)

  const run = (command) => {
    const video = videoOf(current())
    switch (command.action) {
      case 'play':
        wanted = 'play'
        video?.play().catch(() => {})
        break
      case 'pause':
        wanted = 'pause'
        pauseAll()
        break
      case 'next':
        move(1)
        break
      case 'previous':
        move(-1)
        break
      case 'like':
        current()?.querySelector('[data-e2e="like-icon"]')?.click()
        break
      case 'volume':
        volume = Math.min(1, Math.max(0, command.percent / 100))
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

  // An image of TikTok's own image hosts (the author's picture), or none.
  const image = (url) => {
    try {
      const { protocol, hostname } = new URL(url)
      return protocol === 'https:' && /\.tiktokcdn(-[a-z]+)?\.com$/.test(hostname) ? url : null
    } catch {
      return null
    }
  }

  // The copy of the video playing: muted (the sound is the video's own), on the page's root, outside TikTok's.
  const mirror = document.createElement('video')
  mirror.id = 'westplay-mirror'
  mirror.muted = true
  mirror.autoplay = true
  mirror.playsInline = true
  // The video it copies, and that video's source as it was copied (TikTok's player reuses its video elements).
  let mirrored = null
  let mirroredSource = ''
  let copyable = true
  const showCopy = (video) => {
    if (!mirror.isConnected && document.documentElement) document.documentElement.append(mirror)
    const source = video?.currentSrc ?? ''
    if (video !== mirrored || source !== mirroredSource) {
      mirrored = video
      mirroredSource = source
      let stream = null
      try {
        stream = video?.captureStream?.() ?? null
      } catch {
        stream = null
      }
      mirror.srcObject = stream
      copyable = !video || stream !== null
    }
    if (mirror.srcObject && mirror.paused) mirror.play().catch(() => {})
  }

  // Each pass: the video playing shown and held to the player's wishes, and a report when anything but its
  // time changes, or each second while it plays.
  let last = ''
  let lastAt = 0
  setInterval(() => {
    addStyle()
    // The cookie banner: optional cookies declined.
    const banner = document.querySelector('tiktok-cookie-banner')?.shadowRoot
    const decline = banner && [...banner.querySelectorAll('button')]
    if (decline?.length) (decline.find((b) => /decline|refuser|ablehnen|rechazar|reddet/i.test(b.textContent)) ?? decline[0]).click()

    const article = current()
    const video = videoOf(article)
    showCopy(video)
    for (const other of document.querySelectorAll('video.westplay-shown')) {
      if (other !== video || copyable) other.classList.remove('westplay-shown')
    }
    if (video) {
      if (!copyable) video.classList.add('westplay-shown')
      if (Math.abs(video.volume - volume) > 0.01) video.volume = volume
      if (video.muted !== (volume === 0)) video.muted = volume === 0
      if (wanted === 'play' && video.paused && video.readyState >= 2) video.play().catch(() => {})
    }
    // Only the video shown is heard, and none while paused.
    for (const other of videos()) {
      if (!other.paused && (wanted === 'pause' || other !== video)) other.pause()
    }
    cab?.tick()

    const like = article?.querySelector('[data-e2e="like-icon"]')
    liked = like ? like.getAttribute('aria-pressed') === 'true' : null
    const author = article?.querySelector('[data-e2e="video-author-avatar"]')
    const handle = (author?.getAttribute('href') ?? '').replace(/^.*\/@/, '').split(/[/?]/)[0]
    const music = article?.querySelector('a[href*="/music/"]')
    const name = [...(article?.querySelectorAll(`a[href$="/@${handle}"]`) ?? [])]
      .map((link) => link.textContent.trim())
      .find(Boolean)
    const loginButton = document.querySelector('[data-e2e="top-login-button"]')
    const report = {
      loaded: articles().length > 0 || !!loginButton,
      signedIn: articles().length > 0 && !loginButton,
      video: idOf(article),
      author: name ?? handle,
      handle,
      avatar: image(author?.querySelector('img')?.src ?? ''),
      description: text(article, '[data-e2e="video-desc"]').replace(/\s+/g, ' '),
      music: (music?.textContent ?? '').trim(),
      likes: text(article, '[data-e2e="like-count"]'),
      comments: text(article, '[data-e2e="comment-count"]'),
      liked,
      playing: !!video && !video.paused,
      time: video?.currentTime ?? 0,
      duration: Number.isFinite(video?.duration) ? video.duration : 0,
      cabLevel: cab?.level() ?? null,
    }
    const changed = JSON.stringify({ ...report, time: undefined, cabLevel: undefined })
    const now = Date.now()
    if (changed !== last || (report.playing && now - lastAt >= 1000)) {
      last = changed
      lastAt = now
      post(report)
    }
  }, 250)
})()
