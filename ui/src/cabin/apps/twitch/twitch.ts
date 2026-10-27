import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  postToHost,
  type TwitchCard,
  type TwitchCommand,
  type TwitchList,
  type TwitchState,
} from '../../../shared/host'
import type { Hole } from '../youtube/youtube'

/** What the Twitch app shows: a list of channels live, or a channel's stream. */
export type TwitchView = { kind: 'browse'; which: TwitchList } | { kind: 'watch'; card: TwitchCard; from: TwitchList }

/**
 * WestPlay's Twitch: what Twitch's page says (the host runs it hidden, its stream under the cabin page:
 * westplay_host::twitch), the list it last read, what the app shows, where the stream shows, and the volume
 * (kept on this PC, with the list last chosen).
 */
interface TwitchStore {
  /** What Twitch's page says (the host says); `null`: Twitch isn't running. */
  state: TwitchState | null
  /** Twitch's sign-in window is open on the PC's desktop, or the page is yet to say it's signed in. */
  signingIn: boolean
  /** The channels live of the list last read. */
  list: { which: TwitchList; channels: TwitchCard[] } | null
  view: TwitchView
  /** Where the stream shows through the page: the CarPlay area is cut open there (Shell.tsx). */
  hole: Hole | null
  /** The volume, 0-100, and whether it's muted (the volume kept for after). */
  volume: number
  muted: boolean
}

export const useTwitch = create<TwitchStore>()(
  persist(
    () =>
      ({
        state: null,
        signingIn: false,
        list: null,
        view: { kind: 'browse', which: 'popular' },
        hole: null,
        volume: 80,
        muted: false,
      }) as TwitchStore,
    {
      name: 'westplay.twitch',
      storage: createJSONStorage(() => localStorage),
      // The list chosen is kept; a stream isn't (it's gone the next time).
      partialize: (store) => ({
        volume: store.volume,
        muted: store.muted,
        view: store.view.kind === 'browse' ? store.view : { kind: 'browse', which: store.view.from },
      }),
    },
  ),
)

export function command(command: TwitchCommand): void {
  postToHost({ type: 'twitch', command })
}

/** The host's word on Twitch. */
export function receiveTwitch(state: TwitchState | null, signingIn: boolean): void {
  useTwitch.setState({ state, signingIn })
}

export function receiveTwitchList(which: TwitchList, channels: TwitchCard[]): void {
  useTwitch.setState({ list: { which, channels } })
}

/** A list of channels live: Twitch's page taken there (the stream, if one played, stops). */
export function browse(which: TwitchList): void {
  useTwitch.setState({ view: { kind: 'browse', which } })
  command({ action: 'browse', which })
}

/** A channel's stream, playing (`from`: the list it was picked in, to go back to). */
export function watch(card: TwitchCard, from: TwitchList): void {
  useTwitch.setState({ view: { kind: 'watch', card, from } })
  command({ action: 'volume', percent: playingVolume() })
  command({ action: 'watch', channel: card.login })
  command({ action: 'play' })
}

/** The volume Twitch plays at now (none while muted), 0-100. */
export function playingVolume(): number {
  const { volume, muted } = useTwitch.getState()
  return muted ? 0 : volume
}

/** Sets the volume as the player's choice (0-100): unmuted, unless it's none. */
export function setVolume(percent: number): void {
  const volume = Math.round(Math.min(100, Math.max(0, percent)))
  useTwitch.setState({ volume: volume > 0 ? volume : useTwitch.getState().volume, muted: volume === 0 })
  command({ action: 'volume', percent: volume })
}

export function toggleMute(): void {
  const muted = !useTwitch.getState().muted
  useTwitch.setState({ muted })
  command({ action: 'volume', percent: playingVolume() })
}
