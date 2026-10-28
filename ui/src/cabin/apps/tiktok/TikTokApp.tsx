import { type ReactNode, useEffect, useRef } from 'react'
import { IS_DEMO, isInHost } from '../../../shared/host'
import { useLive } from '../../state/store'
import { PageHole } from '../pageHole'
import { command, playingVolume, setVolume, toggleMute, useTikTok } from './tiktok'
import { tiktokWordsFor } from './words'
import './tiktok.css'

/** How long a turn of the wheel holds the next one off, ms: one video per flick. */
const WHEEL_REST_MS = 700

/**
 * WestPlay's TikTok: the For You feed of the player's account. TikTok's own page plays it, hidden, in the host;
 * its video shows through the app (`TikTokHole`), and the app draws its own texts and buttons over the bars
 * beside it. A click on the video plays or pauses it; the wheel goes to the next video or back. Signed out, the
 * app asks for TikTok's sign-in first (TikTok's feed stops a player not signed in after a video or two).
 */
export function TikTokApp() {
  const words = tiktokWordsFor(useLive((state) => state.gameLanguage))
  // The onboarding's demo screen: the app as it opens signed out (its sign-in), nothing run.
  const loaded = useTikTok((store) => store.state?.loaded ?? false) || IS_DEMO
  const signedIn = useTikTok((store) => store.state?.signedIn ?? false) && !IS_DEMO
  const signingIn = useTikTok((store) => store.signingIn)

  // Opened: TikTok runs (started by the first command), at the player's volume; it plays while the app is open
  // and pauses as it closes.
  useEffect(() => {
    if (!isInHost()) return
    command({ action: 'volume', percent: playingVolume() })
    command({ action: 'play' })
    return () => command({ action: 'pause' })
  }, [])

  if (!isInHost() && !IS_DEMO) {
    return (
      <section className="app-panel tiktok-app" aria-label="TikTok">
        <div className="tiktok-message">{words.notInHost}</div>
      </section>
    )
  }
  return (
    <section className="app-panel tiktok-app" aria-label="TikTok">
      {signedIn ? (
        <TikTokHole>
          <Feed />
        </TikTokHole>
      ) : !loaded && !signingIn ? (
        <div className="tiktok-message">{words.loading}</div>
      ) : (
        <div className="tiktok-sign-in">
          <TikTokNote />
          <h2>{words.signInTitle}</h2>
          <p>{words.signInText}</p>
          {signingIn ? (
            <p className="tiktok-waiting">{words.signingIn}</p>
          ) : (
            <button type="button" className="tiktok-button" onClick={() => command({ action: 'signIn' })}>
              {words.signIn}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** What's drawn over the video: its texts on the left, TikTok's buttons on the right, its progress below. */
function Feed() {
  const words = tiktokWordsFor(useLive((state) => state.gameLanguage))
  const state = useTikTok((store) => store.state)
  const muted = useTikTok((store) => store.muted)
  const volume = useTikTok((store) => store.volume)
  const resting = useRef(0)
  if (!state) return null
  const wheel = (event: React.WheelEvent) => {
    const now = performance.now()
    if (now < resting.current || Math.abs(event.deltaY) < 4) return
    resting.current = now + WHEEL_REST_MS
    command({ action: event.deltaY > 0 ? 'next' : 'previous' })
  }
  const progress = state.duration > 0 ? Math.min(1, state.time / state.duration) : 0
  return (
    <div className="tiktok-feed" onWheel={wheel}>
      <button
        type="button"
        className="tiktok-video"
        aria-label={state.playing ? 'Pause' : 'Play'}
        onClick={() => command({ action: state.playing ? 'pause' : 'play' })}
      >
        {!state.playing && state.video && <PlayGlyph />}
      </button>
      <div className="tiktok-about">
        <div className="tiktok-author">
          {state.avatar && <img src={state.avatar} alt="" />}
          <span>{state.author || (state.handle && `@${state.handle}`)}</span>
        </div>
        {state.description && <p className="tiktok-description">{state.description}</p>}
        {state.music && <div className="tiktok-music">♪ {state.music}</div>}
      </div>
      <div className="tiktok-actions">
        <ActionButton label={words.previous} onClick={() => command({ action: 'previous' })}>
          <path d="M6 15l6-6 6 6" />
        </ActionButton>
        <ActionButton
          label={words.like}
          count={state.likes}
          on={state.liked === true}
          onClick={() => command({ action: 'like' })}
        >
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
        </ActionButton>
        <ActionButton label={words.comments} count={state.comments}>
          <path d="M5 6h14v9H10l-4 3v-3H5Z" />
        </ActionButton>
        <div className="tiktok-volume">
          <ActionButton label={muted ? words.unmute : words.mute} onClick={toggleMute}>
            <path d="M4 10h3l5-4v12l-5-4H4Z" />
            {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
          </ActionButton>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={muted ? 0 : volume}
            aria-label={words.volume}
            style={{ '--level': `${muted ? 0 : volume}%` } as React.CSSProperties}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
          <span>{muted ? 0 : volume}</span>
        </div>
        <ActionButton label={words.next} onClick={() => command({ action: 'next' })}>
          <path d="M6 9l6 6 6-6" />
        </ActionButton>
        <button type="button" className="tiktok-sign-out" onClick={() => command({ action: 'signOut' })}>
          {words.signOut}
        </button>
      </div>
      <div className="tiktok-progress" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

function ActionButton({
  label,
  count,
  on = false,
  onClick,
  children,
}: {
  label: string
  count?: string
  on?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={on ? 'tiktok-action on' : 'tiktok-action'}
      aria-label={label}
      aria-pressed={onClick && count !== undefined ? on : undefined}
      disabled={!onClick}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        {children}
      </svg>
      {count !== undefined && <span>{count}</span>}
    </button>
  )
}

function PlayGlyph() {
  return (
    <svg className="tiktok-play" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5v14l11-7Z" />
    </svg>
  )
}

/** The app's note (its icon's), over the sign-in. */
function TikTokNote() {
  return <img className="tiktok-note" src="/icons/westplay/tiktok.dark.svg" alt="" />
}

/** Where TikTok's video shows (pageHole.tsx), what's drawn over it on top. */
function TikTokHole({ children }: { children: ReactNode }) {
  const hole = useTikTok((store) => store.hole)
  return (
    <PageHole
      className="tiktok-hole"
      hole={hole}
      setHole={(hole) => useTikTok.setState({ hole })}
      show={(placed) => command({ action: 'show', ...placed })}
      hide={() => command({ action: 'hide' })}
    >
      {children}
    </PageHole>
  )
}
