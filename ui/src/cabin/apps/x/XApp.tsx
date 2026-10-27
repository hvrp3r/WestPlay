import { useEffect, useRef, useState } from 'react'
import { IS_DEMO, isInHost, type XFeed, type XPost, type XQuote } from '../../../shared/host'
import { useLive } from '../../state/store'
import { PageHole } from '../pageHole'
import { command, like, openThread, setVolume, showFeed, toggleMute, useX, watch } from './x'
import { type XWords, xWordsFor } from './words'
import './x.css'

/** How long the timeline's foot asks for more at most once, ms (X takes a moment to load its next posts). */
const MORE_EVERY_MS = 1500

/**
 * WestPlay's X: the player's timeline (For you, or Following), read from X's own site run hidden in the host, in
 * the app's own look; a post's video plays through the app (`PageHole`), on X's page for that post. X shows
 * nothing to a player not signed in: the app asks for the sign-in first.
 */
export function XApp() {
  const words = xWordsFor(useLive((state) => state.gameLanguage))
  const view = useX((store) => store.view)
  // The onboarding's demo screen: the app as it opens signed out (its sign-in), nothing run.
  const loaded = useX((store) => store.state?.loaded ?? false) || IS_DEMO
  const signedIn = useX((store) => store.state?.signedIn ?? false) && !IS_DEMO
  const signingIn = useX((store) => store.signingIn)

  // Opened: X runs (started by the first command), on the timeline chosen, or the video again (paused as the
  // app closed).
  useEffect(() => {
    if (!isInHost()) return
    const { view, state } = useX.getState()
    if (view.kind === 'feed') command({ action: 'feed', which: view.which })
    else if (view.kind === 'thread') openThread(view.post)
    else if (state?.status !== view.post.id) watch(view.post, view.back)
    else command({ action: 'play' })
    return () => command({ action: 'pause' })
  }, [])

  if (!isInHost() && !IS_DEMO) {
    return (
      <section className="app-panel x-app" aria-label="X">
        <div className="x-message">{words.notInHost}</div>
      </section>
    )
  }
  let content
  if (loaded && !signedIn) {
    content = (
      <div className="x-message">
        <XMark />
        <h2>{words.signInTitle}</h2>
        <p>{words.signInText}</p>
        {signingIn ? (
          <p className="x-waiting">{words.signingIn}</p>
        ) : (
          <button type="button" className="x-button" onClick={() => command({ action: 'signIn' })}>
            {words.signIn}
          </button>
        )}
      </div>
    )
  } else if (!loaded) {
    content = <div className="x-message">{words.loading}</div>
  } else if (view.kind === 'feed') {
    content = <Feed which={view.which} words={words} />
  } else if (view.kind === 'thread') {
    content = <Thread post={view.post} which={view.which} words={words} />
  } else {
    content = <Watch post={view.post} which={view.which} back={view.back} words={words} />
  }
  return (
    <section className="app-panel x-app" aria-label="X">
      {content}
    </section>
  )
}

/** The timeline: its tabs, its posts, more as its foot comes into view. */
function Feed({ which, words }: { which: XFeed; words: XWords }) {
  const timeline = useX((store) => store.timeline)
  const posts = timeline?.which === which ? timeline.posts : null
  const shown = posts !== null
  const now = useNow()
  const foot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = foot.current
    if (!element) return
    let last = 0
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || performance.now() - last < MORE_EVERY_MS) return
      last = performance.now()
      command({ action: 'more' })
    })
    seen.observe(element)
    return () => seen.disconnect()
  }, [shown])
  return (
    <div className="x-feed">
      <header className="x-bar">
        <div className="x-tabs" role="tablist">
          {(['forYou', 'following'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={tab === which}
              className={tab === which ? 'x-tab on' : 'x-tab'}
              onClick={() => tab !== which && showFeed(tab)}
            >
              {words[tab]}
            </button>
          ))}
        </div>
        <div className="x-bar-end">
          <button
            type="button"
            className="x-link"
            onClick={() => {
              useX.setState({ timeline: null })
              command({ action: 'home' })
              command({ action: 'feed', which })
            }}
          >
            {words.refresh}
          </button>
          <button type="button" className="x-link" onClick={() => command({ action: 'signOut' })}>
            {words.signOut}
          </button>
        </div>
      </header>
      <div className="x-posts">
        {posts === null ? (
          <div className="x-message">{words.loading}</div>
        ) : posts.length === 0 ? (
          <div className="x-message">{words.empty}</div>
        ) : (
          posts.map((post) => <Post key={post.id} post={post} now={now} words={words} open={() => openThread(post)} />)
        )}
        <div ref={foot} className="x-foot" />
      </div>
    </div>
  )
}

/** The time now, ms, again each minute (for how long ago posts were posted). */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** A post: its author, whom it answers, its text, pictures or video, and its counts. */
function Post({
  post,
  now,
  words,
  open,
  focal = false,
  answered = false,
  back,
}: {
  post: XPost
  now: number
  words: XWords
  /** Pressing it (but on its buttons) opens its conversation. */
  open?: () => void
  /** The post a conversation is opened on: larger. */
  focal?: boolean
  /** A post the next one answers: a line from its picture down to the next's. */
  answered?: boolean
  /** The conversation its video is watched from. */
  back?: XPost
}) {
  const seconds = (now - Date.parse(post.time)) / 1000
  const classes = ['x-post', focal && 'focal', answered && 'answered', open && 'opens'].filter(Boolean).join(' ')
  return (
    <article
      className={classes}
      onClick={(event) => {
        if (open && !(event.target as Element).closest('button')) open()
      }}
    >
      <div className="x-side">
        {post.avatar ? <img className="x-avatar" src={post.avatar} alt="" /> : <span className="x-avatar" />}
        {answered && <span className="x-thread-line" />}
      </div>
      <div className="x-body">
        {post.context && <div className="x-context">{post.context}</div>}
        <div className="x-who">
          <span className="x-name">{post.name}</span>
          {post.handle && <span className="x-handle">@{post.handle}</span>}
          {Number.isFinite(seconds) && <span className="x-handle">· {words.ago(Math.max(0, seconds))}</span>}
        </div>
        {post.replyTo.length > 0 && (
          <div className="x-reply-to">{words.replyingTo(post.replyTo.map((handle) => `@${handle}`).join(' '))}</div>
        )}
        {post.text && <p className="x-text">{post.text}</p>}
        {post.video !== null ? (
          <button type="button" className="x-media x-video" aria-label={words.watch} onClick={() => watch(post, back)}>
            {post.video && <img src={post.video} alt="" />}
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5v14l11-7Z" />
            </svg>
          </button>
        ) : (
          post.images.length > 0 && (
            <div className={`x-media x-images x-images-${post.images.length}`}>
              {post.images.map((src) => (
                <img key={src} src={src} alt="" />
              ))}
            </div>
          )
        )}
        {post.quote && <Quoted quote={post.quote} now={now} words={words} />}
        <div className="x-counts">
          <span aria-label={words.replies}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M5 6h14v9H10l-4 3v-3H5Z" />
            </svg>
            {post.replies}
          </span>
          <span aria-label={words.reposts}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M7 7h9l-2-2M17 17H8l2 2M7 7v6M17 17v-6" />
            </svg>
            {post.reposts}
          </span>
          <button
            type="button"
            className={post.liked ? 'x-like on' : 'x-like'}
            aria-label={words.like}
            aria-pressed={post.liked}
            onClick={() => like(post)}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
            </svg>
            {post.likes}
          </button>
        </div>
      </div>
    </article>
  )
}

/** The post a post quotes, in a box inside it: pressing it opens its conversation (when X links it). */
function Quoted({ quote, now, words }: { quote: XQuote; now: number; words: XWords }) {
  const seconds = (now - Date.parse(quote.time)) / 1000
  const id = quote.id
  const inner = (
    <>
      <span className="x-who">
        {quote.avatar && <img className="x-quote-avatar" src={quote.avatar} alt="" />}
        <span className="x-name">{quote.name}</span>
        {quote.handle && <span className="x-handle">@{quote.handle}</span>}
        {Number.isFinite(seconds) && <span className="x-handle">· {words.ago(Math.max(0, seconds))}</span>}
      </span>
      {quote.text && <span className="x-quote-text">{quote.text}</span>}
      {quote.images.length > 0 ? (
        <span className={`x-images x-images-${Math.min(quote.images.length, 2)}`}>
          {quote.images.slice(0, 2).map((src) => (
            <img key={src} src={src} alt="" />
          ))}
        </span>
      ) : (
        quote.video && (
          <span className="x-images x-images-1">
            <img src={quote.video} alt="" />
          </span>
        )
      )}
    </>
  )
  if (!id) return <div className="x-quote">{inner}</div>
  return (
    <button
      type="button"
      className="x-quote"
      onClick={() =>
        openThread({
          ...quote,
          id,
          replyTo: [],
          context: '',
          replies: '',
          reposts: '',
          likes: '',
          liked: false,
          quote: null,
        })
      }
    >
      {inner}
    </button>
  )
}

/** A post's conversation: the posts it answers, above it (a line linking each to the next), it, larger, and the
 * replies to it under. */
function Thread({ post, which, words }: { post: XPost; which: XFeed; words: XWords }) {
  const thread = useX((store) => store.thread)
  const now = useNow()
  const posts = thread?.id === post.id ? thread.posts : null
  const at = posts?.findIndex((each) => each.id === post.id) ?? -1
  // Until its page says, the post itself.
  const above = posts && at >= 0 ? posts.slice(0, at) : []
  const focal = posts && at >= 0 ? posts[at] : post
  const answers = posts && at >= 0 ? posts.slice(at + 1) : []
  return (
    <div className="x-feed">
      <header className="x-bar x-thread-bar">
        <button type="button" className="x-back" aria-label={words.back} onClick={() => showFeed(which)}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <h2>{words.conversation}</h2>
      </header>
      <div className="x-posts">
        {above.map((each) => (
          <Post key={each.id} post={each} now={now} words={words} answered back={post} open={() => openThread(each)} />
        ))}
        <Post post={focal} now={now} words={words} focal back={post} />
        {posts === null && <div className="x-message">{words.loading}</div>}
        {answers.length > 0 && <div className="x-answers">{words.answers}</div>}
        {answers.map((each) => (
          <Post key={each.id} post={each} now={now} words={words} back={post} open={() => openThread(each)} />
        ))}
      </div>
    </div>
  )
}

/** A post's video, through the app, with its own controls over it. */
function Watch({ post, which, back, words }: { post: XPost; which: XFeed; back?: XPost; words: XWords }) {
  const hole = useX((store) => store.hole)
  const state = useX((store) => store.state)
  const volume = useX((store) => store.volume)
  const muted = useX((store) => store.muted)
  const here = state?.status === post.id ? state : null
  const level = muted ? 0 : volume
  return (
    <PageHole
      className="x-hole"
      hole={hole}
      setHole={(hole) => useX.setState({ hole })}
      show={(placed) => command({ action: 'show', ...placed })}
      hide={() => command({ action: 'hide' })}
    >
      <div className="x-stream">
        <button
          type="button"
          className="x-video-press"
          aria-label={here?.playing ? 'Pause' : 'Play'}
          onClick={() => command({ action: here?.playing ? 'pause' : 'play' })}
        >
          {here?.video && !here.playing && (
            <svg className="x-play" viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5v14l11-7Z" />
            </svg>
          )}
        </button>
        <header className="x-top">
          <button
            type="button"
            className="x-round"
            aria-label={words.back}
            onClick={() => (back ? openThread(back) : showFeed(which))}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          {post.avatar && <img className="x-avatar" src={post.avatar} alt="" />}
          <div className="x-top-texts">
            <span className="x-name">{post.name}</span>
            {post.text && <span className="x-top-text">{post.text}</span>}
          </div>
        </header>
        <div className="x-volume">
          <button type="button" className="x-round" aria-label={muted ? words.unmute : words.mute} onClick={toggleMute}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 10h3l5-4v12l-5-4H4Z" />
              {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={level}
            aria-label={words.volume}
            style={{ '--level': `${level}%` } as React.CSSProperties}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
          <span>{level}</span>
        </div>
      </div>
    </PageHole>
  )
}

/** The app's mark (its icon's), over the sign-in. */
function XMark() {
  return <img className="x-mark" src="/icons/westplay/x.dark.svg" alt="" />
}
