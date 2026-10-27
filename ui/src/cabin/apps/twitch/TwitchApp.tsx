import { useEffect, useState } from 'react'
import { IS_DEMO, isInHost, type TwitchCard, type TwitchList } from '../../../shared/host'
import { useLive } from '../../state/store'
import { PageHole } from '../pageHole'
import { browse, command, setVolume, toggleMute, useTwitch, watch } from './twitch'
import { twitchWordsFor } from './words'
import './twitch.css'

/** How long a channel's page has to say it's live before the app says it isn't, ms. */
const OFFLINE_AFTER_MS = 8000

/**
 * WestPlay's Twitch: the channels live (the player's followed ones, or the most watched), and a channel's stream.
 * Twitch's own site does it all, hidden, in the host: taken to a list's page, it reads its cards; to a channel's,
 * its stream shows through the app (`PageHole`), the app's own controls over it. The stream plays on, heard, once
 * the app is left (as a radio would), until it's paused or another player starts.
 */
export function TwitchApp() {
  const words = twitchWordsFor(useLive((state) => state.gameLanguage))
  const view = useTwitch((store) => store.view)

  // Opened: Twitch runs (started by the first command), on the list shown, or the stream (again, if Twitch was
  // closed since: the game closing closes it).
  useEffect(() => {
    if (!isInHost()) return
    const { view, state } = useTwitch.getState()
    if (view.kind === 'browse') browse(view.which)
    else if (state?.channel !== view.card.login) watch(view.card, view.from)
  }, [])

  if (!isInHost() && !IS_DEMO) {
    return (
      <section className="app-panel twitch-app" aria-label="Twitch">
        <div className="twitch-message">{words.notInHost}</div>
      </section>
    )
  }
  return (
    <section className="app-panel twitch-app" aria-label="Twitch">
      {view.kind === 'browse' ? <Browse which={view.which} /> : <Watch card={view.card} from={view.from} />}
    </section>
  )
}

/** A list of channels live: its tabs, the account, and its cards. */
function Browse({ which }: { which: TwitchList }) {
  const words = twitchWordsFor(useLive((state) => state.gameLanguage))
  const state = useTwitch((store) => store.state)
  const signingIn = useTwitch((store) => store.signingIn)
  const list = useTwitch((store) => store.list)
  const signedIn = state?.signedIn ?? false
  const channels = list?.which === which ? list.channels : null
  // The onboarding's demo screen: the app as it opens signed out (its sign-in), nothing run.
  const askSignIn = IS_DEMO || (which === 'following' && !!state?.loaded && !signedIn)
  return (
    <div className="twitch-browse">
      <header className="twitch-bar">
        <div className="twitch-tabs" role="tablist">
          {(['following', 'popular'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={tab === which}
              className={tab === which ? 'twitch-tab on' : 'twitch-tab'}
              onClick={() => tab !== which && browse(tab)}
            >
              {words[tab]}
            </button>
          ))}
        </div>
        {signingIn ? (
          <span className="twitch-waiting">{words.signingIn}</span>
        ) : signedIn ? (
          <button type="button" className="twitch-link" onClick={() => command({ action: 'signOut' })}>
            {words.signOut}
          </button>
        ) : (
          <button type="button" className="twitch-button" onClick={() => command({ action: 'signIn' })}>
            {words.signIn}
          </button>
        )}
      </header>
      {askSignIn ? (
        <div className="twitch-message">{words.signInFollowing}</div>
      ) : channels === null ? (
        <div className="twitch-message">{words.loading}</div>
      ) : channels.length === 0 ? (
        <div className="twitch-message">{words.noneLive}</div>
      ) : (
        <div className="twitch-grid">
          {channels.map((card) => (
            <Card key={card.login} card={card} live={words.live} onClick={() => watch(card, which)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Card({ card, live, onClick }: { card: TwitchCard; live: string; onClick(): void }) {
  return (
    <button type="button" className="twitch-card" onClick={onClick}>
      <span className="twitch-thumb">
        {card.thumbnail && <img src={card.thumbnail} alt="" />}
        <span className="twitch-live">{live}</span>
        {card.viewers && <span className="twitch-viewers">{card.viewers}</span>}
      </span>
      <span className="twitch-about">
        {card.avatar ? <img className="twitch-avatar" src={card.avatar} alt="" /> : <span className="twitch-avatar" />}
        <span className="twitch-texts">
          <span className="twitch-title">{card.title}</span>
          <span className="twitch-name">{card.name}</span>
          <span className="twitch-game">{card.game}</span>
        </span>
      </span>
    </button>
  )
}

/** A channel's stream, through the app, with its own controls over it. */
function Watch({ card, from }: { card: TwitchCard; from: TwitchList }) {
  const words = twitchWordsFor(useLive((state) => state.gameLanguage))
  const hole = useTwitch((store) => store.hole)
  const state = useTwitch((store) => store.state)
  const volume = useTwitch((store) => store.volume)
  const muted = useTwitch((store) => store.muted)
  const here = state?.channel === card.login ? state : null
  // Not said live a while after its page was asked for: it isn't.
  const [waitedFor, setWaitedFor] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setWaitedFor(card.login), OFFLINE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [card.login])
  const waited = waitedFor === card.login
  const offline = waited && !!here?.loaded && !here.live && !here.playing
  const level = muted ? 0 : volume
  return (
    <PageHole
      className="twitch-hole"
      hole={hole}
      setHole={(hole) => useTwitch.setState({ hole })}
      show={(placed) => command({ action: 'show', ...placed })}
      hide={() => command({ action: 'hide' })}
    >
      <div className="twitch-stream">
        <button
          type="button"
          className="twitch-video"
          aria-label={here?.playing ? 'Pause' : 'Play'}
          onClick={() => command({ action: here?.playing ? 'pause' : 'play' })}
        >
          {here && !here.playing && here.live && !here.gate && (
            <svg className="twitch-play" viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5v14l11-7Z" />
            </svg>
          )}
        </button>
        <header className="twitch-top">
          <button type="button" className="twitch-back" aria-label={words.back} onClick={() => browse(from)}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          {card.avatar && <img className="twitch-avatar" src={card.avatar} alt="" />}
          <div className="twitch-texts">
            <span className="twitch-name">{here?.name || card.name}</span>
            <span className="twitch-title">{here?.title || card.title}</span>
            <span className="twitch-game">{here?.game || card.game}</span>
          </div>
          {here?.live && (
            <span className="twitch-count">
              <span className="twitch-live">{words.live}</span> {here.viewers}
            </span>
          )}
        </header>
        {here?.gate && (
          <div className="twitch-gate">
            <p>{words.gate}</p>
            <button type="button" className="twitch-button" onClick={() => command({ action: 'acceptGate' })}>
              {words.watchAnyway}
            </button>
          </div>
        )}
        {offline && <div className="twitch-gate">{words.offline}</div>}
        <div className="twitch-volume">
          <button type="button" aria-label={muted ? words.unmute : words.mute} onClick={toggleMute}>
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
