import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { postToHost, type TikTokCommand, type TikTokState } from '../../../shared/host'
import type { Hole } from '../youtube/youtube'

/**
 * WestPlay's TikTok: what TikTok's page plays (the host runs it hidden, its video under the cabin page:
 * westplay_host::tiktok), whether its sign-in is under way, where the video shows, and the volume (kept on this
 * PC).
 */
interface TikTokStore {
  /** What plays (the host says); `null`: TikTok isn't running. */
  state: TikTokState | null
  /** TikTok's sign-in window is open on the PC's desktop, or the page is yet to say it's signed in. */
  signingIn: boolean
  /** Where the video shows through the page: the CarPlay area is cut open there (Shell.tsx). */
  hole: Hole | null
  /** The volume, 0-100, and whether it's muted (the volume kept for after). */
  volume: number
  muted: boolean
}

export const useTikTok = create<TikTokStore>()(
  persist(() => ({ state: null, signingIn: false, hole: null, volume: 80, muted: false }) as TikTokStore, {
    name: 'westplay.tiktok',
    storage: createJSONStorage(() => localStorage),
    partialize: (store) => ({ volume: store.volume, muted: store.muted }),
  }),
)

export function command(command: TikTokCommand): void {
  postToHost({ type: 'tiktok', command })
}

/** The host's word on TikTok. */
export function receiveTikTok(state: TikTokState | null, signingIn: boolean): void {
  useTikTok.setState({ state, signingIn })
}

/** The volume TikTok plays at now (none while muted), 0-100. */
export function playingVolume(): number {
  const { volume, muted } = useTikTok.getState()
  return muted ? 0 : volume
}

/** Sets the volume as the player's choice (0-100): unmuted, unless it's none. */
export function setVolume(percent: number): void {
  const volume = Math.round(Math.min(100, Math.max(0, percent)))
  useTikTok.setState({ volume: volume > 0 ? volume : useTikTok.getState().volume, muted: volume === 0 })
  command({ action: 'volume', percent: volume })
}

export function toggleMute(): void {
  const muted = !useTikTok.getState().muted
  useTikTok.setState({ muted })
  command({ action: 'volume', percent: playingVolume() })
}
