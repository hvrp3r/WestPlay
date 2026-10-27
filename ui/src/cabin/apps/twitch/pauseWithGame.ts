import { type MusicPlayer, pauseMusicWithGame } from '../musicWithGame'
import { command, playingVolume, setVolume, useTwitch } from './twitch'

/** Twitch as one of the cab's players (oneAtATime.ts). */
export const twitchPlayer: MusicPlayer = {
  name: 'twitch',
  playingHere: () => useTwitch.getState().state?.playing ?? false,
  pauseHere: () => command({ action: 'pause' }),
  resumeHere: () => command({ action: 'play' }),
  volume: () => playingVolume() / 100,
  sendVolume: (share) => command({ action: 'volume', percent: Math.round(share * 100) }),
  setVolume: (share) => setVolume(share * 100),
  subscribe: (changed) =>
    useTwitch.subscribe((twitch, before) => changed(!!twitch.state?.playing && !before.state?.playing)),
}

/** Twitch with the game (musicWithGame.ts). Returns the function that stops it. */
export function pauseTwitchWithGame(): () => void {
  return pauseMusicWithGame(twitchPlayer)
}
