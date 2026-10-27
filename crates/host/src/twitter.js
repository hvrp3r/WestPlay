// WestPlay: X's site (x.com, formerly Twitter), hidden, as the engine of the cab's X app (twitter.rs). Run before
// X's own scripts, after cab_sound.js. On the player's timeline (x.com/home), this script reads the posts as X
// shows them and tells them (scrolling on for more when asked), switches between For you and Following, and
// likes a post when asked; on a post's own page (its video watched), it shows that video alone, filling the page,
// and plays, pauses and sets its volume. And whether the page is signed in; nothing else of the account.
//
// X's site as known on 2026-10-27 (signed in: not seen, X shows nothing to a page not signed in): each post an
// `article[data-testid="tweet"]` with `User-Name`, `tweetText`, `tweetPhoto`, `videoPlayer`,
// `Tweet-User-Avatar`, `socialContext`, and its buttons `reply`, `retweet`, `like` (`unlike` once liked), its
// link to itself the one around its `time`; the timeline's tabs in its `tablist`. A page not signed in links to
// X's sign-in (`mode=login`, `/login`, `/i/flow/login`).
;(() => {
  if (window.top !== window || window.westplayTwitter) return
  window.westplayTwitter = true
  const post = (message) => window.chrome?.webview?.postMessage(message)

  // Nothing of X's site shows but a post's video, filling the page: a copy, live (its picture captured), outside
  // X's page (as tiktok.js's).
  const STYLE = `
    html, body { background: #000 !important; }
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
    if (document.getElementById('westplay-twitter')) return
    const style = document.createElement('style')
    style.id = 'westplay-twitter'
    style.textContent = STYLE
    ;(document.head ?? document.documentElement)?.append(style)
  }
  addStyle()
  document.addEventListener('DOMContentLoaded', addStyle)

  const image = (url) => (typeof url === 'string' && url.startsWith('https://pbs.twimg.com/') ? url : null)
  // Which page this is: the timeline, or a post's own (its id).
  const page = () => {
    const path = location.pathname
    if (path === '/home') return { home: true }
    const status = path.match(/\/status\/(\d{5,25})/)?.[1]
    return status ? { status } : {}
  }
  const posts = () => {
    const marked = [...document.querySelectorAll('article[data-testid="tweet"]')]
    return marked.length > 0 ? marked : [...document.querySelectorAll('main article')]
  }
  const idOf = (article) => {
    const own = article.querySelector('a[href*="/status/"] time')?.closest('a')
    const link = own ?? article.querySelector('a[href*="/status/"]')
    return link?.getAttribute('href').match(/\/status\/(\d{5,25})/)?.[1] ?? null
  }
  // An element's text, read from its nodes: its page is hidden, and a hidden element's `innerText` is empty
  // (2026-10-27: the posts came with their pictures, not their text). Emoji are pictures with their own as `alt`;
  // a `br` is a new line.
  const textOf = (element) => {
    if (!element) return ''
    let text = ''
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue
        else if (child.nodeName === 'IMG') text += child.getAttribute('alt') ?? ''
        else if (child.nodeName === 'BR') text += '\n'
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child)
      }
    }
    walk(element)
    return text.trim()
  }
  // Its texts, each piece apart (a post's author: the name, the @handle, the time).
  const piecesOf = (element) =>
    element
      ? [...element.querySelectorAll('span, time')]
          .filter((span) => !span.querySelector('span'))
          .map(textOf)
          .filter(Boolean)
      : []
  // A button's count as X shows it ("1.2K"), or none.
  const count = (article, ids) => textOf(article.querySelector(ids.map((id) => `[data-testid="${id}"]`).join(', ')))

  // Whom a reply answers: X's "Replying to @someone" over its text (in X's language: the account's), its handles.
  const REPLYING = /^(Replying to|En réponse à|In reply to|Antwort an|En respuesta a|Em resposta a|In risposta a)\s/i
  const replyTo = (article, quote) => {
    for (const div of article.querySelectorAll('div')) {
      if (div.querySelector('div') || div.closest('[data-testid="tweetText"]') || quote?.contains(div)) continue
      const text = textOf(div)
      if (REPLYING.test(text)) return [...text.matchAll(/@(\w{1,15})/g)].map((match) => match[1]).slice(0, 5)
    }
    return []
  }

  // The post a post quotes, shown inside it: the box (`div[role="link"]`) around the second author in it.
  const quoteOf = (article) => article.querySelectorAll('[data-testid="User-Name"]')[1]?.closest('div[role="link"]') ?? null
  // In `root`, what's its own: not in the post it quotes (`quote`).
  const ownAll = (root, quote, selector) =>
    [...root.querySelectorAll(selector)].filter((element) => !quote?.contains(element))
  const own = (root, quote, selector) => ownAll(root, quote, selector)[0] ?? null
  // The author, text, pictures and video of a post (`root`: its article, or the box of the post it quotes).
  const content = (root, quote) => {
    const lines = piecesOf(own(root, quote, '[data-testid="User-Name"]')).filter((piece) => piece !== '·')
    const video = own(root, quote, '[data-testid="videoPlayer"], video')
    return {
      name: lines[0] ?? '',
      handle: (lines.find((line) => line.startsWith('@')) ?? '').slice(1),
      avatar: image(own(root, quote, '[data-testid="Tweet-User-Avatar"] img, img[src*="/profile_images/"]')?.src),
      text: textOf(own(root, quote, '[data-testid="tweetText"]')),
      time: own(root, quote, 'time')?.getAttribute('datetime') ?? '',
      images: ownAll(root, quote, '[data-testid="tweetPhoto"] img')
        .map((img) => image(img.src))
        .filter(Boolean)
        .slice(0, 4),
      video: video
        ? (image(video.querySelector?.('video')?.getAttribute('poster') ?? video.getAttribute?.('poster')) ?? '')
        : null,
    }
  }

  // A post, as the app shows it, with the post it quotes (its id, if X links it).
  const read = (article) => {
    const id = idOf(article)
    if (!id) return null
    const quote = quoteOf(article)
    const quoted = quote && {
      id: quote.querySelector('a[href*="/status/"]')?.getAttribute('href').match(/\/status\/(\d{5,25})/)?.[1] ?? null,
      ...content(quote, null),
    }
    return {
      id,
      replyTo: replyTo(article, quote),
      ...content(article, quote),
      context: textOf(article.querySelector('[data-testid="socialContext"]')),
      quote: quoted && (quoted.text || quoted.name) ? quoted : null,
      replies: count(article, ['reply']),
      reposts: count(article, ['retweet', 'unretweet']),
      likes: count(article, ['like', 'unlike']),
      liked: !!article.querySelector('[data-testid="unlike"]'),
    }
  }

  // The timeline's posts read so far, in its order (X keeps only those near what shows: the others are kept here).
  let seen = new Map()
  const reset = () => {
    seen = new Map()
    lastFeed = ''
  }
  let lastFeed = ''

  // What the player asked for: playing or paused, and the volume (0 to 1), held to as X's player sets its own.
  let wanted = 'play'
  let volume = 0.8
  let wantedFeed = null
  // A post's page: its conversation, the posts it answers above it; its video is its own article's.
  const player = () =>
    posts()
      .find((article) => idOf(article) === page().status)
      ?.querySelector('video') ?? document.querySelector('video')
  let lastThread = ''

  // The truck's own speakers (cab_sound.js), playing a post's video's sound.
  const cab = window.westplayCabSound?.(() => (page().status ? player() : null), post)

  const run = (command) => {
    const video = page().status ? player() : null
    switch (command.action) {
      // For you or Following: X's own tab, once it's there (this command may come as the page starts).
      case 'feed':
        wantedFeed = command.which
        break
      case 'more':
        window.scrollBy(0, window.innerHeight * 2)
        break
      case 'like': {
        const article = posts().find((each) => idOf(each) === command.id)
        article?.querySelector('[data-testid="like"], [data-testid="unlike"]')?.click()
        break
      }
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

  // The copy of the video: muted (the sound is the video's own), on the page's root, outside X's.
  const mirror = document.createElement('video')
  mirror.id = 'westplay-mirror'
  mirror.muted = true
  mirror.autoplay = true
  mirror.playsInline = true
  let mirrored = null
  let mirroredSource = ''
  const showCopy = (video) => {
    if (!mirror.isConnected && document.documentElement) document.documentElement.append(mirror)
    const source = video?.currentSrc ?? ''
    if (video !== mirrored || source !== mirroredSource) {
      mirrored = video
      mirroredSource = source
      try {
        mirror.srcObject = video?.captureStream?.() ?? null
      } catch {
        mirror.srcObject = null
      }
    }
    if (mirror.srcObject && mirror.paused) mirror.play().catch(() => {})
  }

  let last = ''
  let lastAt = 0
  setInterval(() => {
    addStyle()
    const where = page()

    // The timeline: posts as they're read, told as they change.
    if (where.home) {
      // The timeline asked for: its tab (For you first, Following second), pressed once it's there.
      const tabs = document.querySelectorAll('[role="tablist"] [role="tab"]')
      if (wantedFeed && tabs.length >= 2) {
        const tab = tabs[wantedFeed === 'following' ? 1 : 0]
        if (tab.getAttribute('aria-selected') !== 'true') {
          tab.click()
          reset()
          window.scrollTo(0, 0)
        }
        wantedFeed = null
      }
      for (const article of posts()) {
        const read_ = read(article)
        if (read_) seen.set(read_.id, read_)
      }
      const feed = [...seen.values()].slice(0, 150)
      const told = JSON.stringify(feed)
      if (told !== lastFeed && feed.length > 0) {
        lastFeed = told
        const which = tabs[1]?.getAttribute('aria-selected') === 'true' ? 'following' : 'forYou'
        post({ feed: { which, posts: feed } })
      }
    } else if (seen.size > 0) {
      reset()
    }

    // A post's page: its conversation as X shows it (the posts it answers, it, the replies to it), told as it
    // changes.
    if (where.status) {
      const conversation = posts().map(read).filter(Boolean).slice(0, 60)
      const told = JSON.stringify(conversation)
      if (told !== lastThread && conversation.some((each) => each.id === where.status)) {
        lastThread = told
        post({ thread: { id: where.status, posts: conversation } })
      }
    } else {
      lastThread = ''
    }

    const video = where.status ? player() : null
    showCopy(video)
    if (video) {
      if (Math.abs(video.volume - volume) > 0.01) video.volume = volume
      if (video.muted !== (volume === 0)) video.muted = volume === 0
      if (wanted === 'play' && video.paused && video.readyState >= 2) video.play().catch(() => {})
      if (wanted === 'pause' && !video.paused) video.pause()
    }
    cab?.tick()

    const signInLink = document.querySelector(
      'a[href*="mode=login"], a[href="/login"], a[href^="/i/flow/login"], [data-testid="loginButton"]',
    )
    const signingInPage = /^\/(i\/flow\/login|i\/jf\/onboarding|login)/.test(location.pathname)
    const signedIn =
      !signInLink && !signingInPage && !!document.querySelector('[data-testid="AppTabBar_Home_Link"], a[href="/home"]')
    const report = {
      loaded: signedIn || !!signInLink || signingInPage,
      signedIn,
      status: where.status ?? null,
      video: !!video,
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
  }, 400)
})()
