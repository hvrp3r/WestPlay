import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { postToHost, type XCommand, type XFeed, type XPost, type XState } from '../../../shared/host'
import type { Hole } from '../youtube/youtube'

/** What the X app shows: a timeline, a post's conversation, or a post's video (`back`: the conversation it was
 * opened from, to go back to). */
export type XView =
  | { kind: 'feed'; which: XFeed }
  | { kind: 'thread'; post: XPost; which: XFeed }
  | { kind: 'watch'; post: XPost; which: XFeed; back?: XPost }

/**
 * WestPlay's X: what X's page says (the host runs it hidden: westplay_host::twitter), the timeline it last read,
 * what the app shows, where a video shows, and the volume (kept on this PC, with the timeline chosen).
 */
interface XStore {
  /** What X's page says (the host says); `null`: X isn't running. */
  state: XState | null
  /** X's sign-in window is open on the PC's desktop, or the page is yet to say it's signed in. */
  signingIn: boolean
  timeline: { which: XFeed; posts: XPost[] } | null
  /** The conversation of the post opened last, as its page shows it. */
  thread: { id: string; posts: XPost[] } | null
  view: XView
  /** Where a post's video shows through the page: the CarPlay area is cut open there (Shell.tsx). */
  hole: Hole | null
  /** The volume, 0-100, and whether it's muted (the volume kept for after). */
  volume: number
  muted: boolean
}

export const useX = create<XStore>()(
  persist(
    () =>
      ({
        state: null,
        signingIn: false,
        timeline: null,
        thread: null,
        view: { kind: 'feed', which: 'forYou' },
        hole: null,
        volume: 80,
        muted: false,
      }) as XStore,
    {
      name: 'westplay.x',
      storage: createJSONStorage(() => localStorage),
      // The timeline chosen is kept; a video isn't.
      partialize: (store) => ({
        volume: store.volume,
        muted: store.muted,
        view: { kind: 'feed', which: store.view.which },
      }),
    },
  ),
)

export function command(command: XCommand): void {
  postToHost({ type: 'twitter', command })
}

/** The host's word on X. */
export function receiveX(state: XState | null, signingIn: boolean): void {
  useX.setState({ state, signingIn })
}

export function receiveXTimeline(which: XFeed, posts: XPost[]): void {
  useX.setState({ timeline: { which, posts } })
}

export function receiveXThread(id: string, posts: XPost[]): void {
  useX.setState({ thread: { id, posts } })
}

/** A post's conversation: its page (the posts it answers above it, the replies under it). */
export function openThread(post: XPost): void {
  const { view, thread } = useX.getState()
  useX.setState({ view: { kind: 'thread', post, which: view.which }, thread: thread?.id === post.id ? thread : null })
  command({ action: 'thread', id: post.id })
}

/** A timeline: X's own tab (from a post's page, the timeline's page again first). */
export function showFeed(which: XFeed): void {
  const { view, timeline } = useX.getState()
  useX.setState({
    view: { kind: 'feed', which },
    timeline: timeline?.which === which ? timeline : null,
  })
  if (view.kind !== 'feed') command({ action: 'home' })
  command({ action: 'feed', which })
}

/** A post's video, playing (from its conversation, or the conversation it's in: `back`). */
export function watch(post: XPost, back?: XPost): void {
  useX.setState({ view: { kind: 'watch', post, which: useX.getState().view.which, back } })
  command({ action: 'volume', percent: playingVolume() })
  command({ action: 'watch', id: post.id })
  command({ action: 'play' })
}

/** Likes a post (on the timeline, or in the conversation shown), or takes the like back: shown at once, X's page
 * telling the count after. */
export function like(post: XPost): void {
  const { timeline, thread } = useX.getState()
  const toggled = (posts: XPost[]) =>
    posts.map((each) => (each.id === post.id ? { ...each, liked: !each.liked } : each))
  useX.setState({
    timeline: timeline && { ...timeline, posts: toggled(timeline.posts) },
    thread: thread && { ...thread, posts: toggled(thread.posts) },
  })
  command({ action: 'like', id: post.id })
}

/** The volume X plays at now (none while muted), 0-100. */
export function playingVolume(): number {
  const { volume, muted } = useX.getState()
  return muted ? 0 : volume
}

/** Sets the volume as the player's choice (0-100): unmuted, unless it's none. */
export function setVolume(percent: number): void {
  const volume = Math.round(Math.min(100, Math.max(0, percent)))
  useX.setState({ volume: volume > 0 ? volume : useX.getState().volume, muted: volume === 0 })
  command({ action: 'volume', percent: volume })
}

export function toggleMute(): void {
  const muted = !useX.getState().muted
  useX.setState({ muted })
  command({ action: 'volume', percent: playingVolume() })
}
