import { type MusicPlayer, pauseMusicWithGame } from '../musicWithGame'
import { command, playingVolume, setVolume, useX } from './x'

/** X (a post's video) as one of the cab's players (oneAtATime.ts). */
export const xPlayer: MusicPlayer = {
  name: 'x',
  playingHere: () => useX.getState().state?.playing ?? false,
  pauseHere: () => command({ action: 'pause' }),
  resumeHere: () => command({ action: 'play' }),
  volume: () => playingVolume() / 100,
  sendVolume: (share) => command({ action: 'volume', percent: Math.round(share * 100) }),
  setVolume: (share) => setVolume(share * 100),
  subscribe: (changed) => useX.subscribe((x, before) => changed(!!x.state?.playing && !before.state?.playing)),
}

/** X with the game (musicWithGame.ts). Returns the function that stops it. */
export function pauseXWithGame(): () => void {
  return pauseMusicWithGame(xPlayer)
}
