import { type MusicPlayer, pauseMusicWithGame } from '../musicWithGame'
import { command, playingVolume, setVolume, useTikTok } from './tiktok'

/** TikTok as one of the cab's players (oneAtATime.ts). */
export const tiktokPlayer: MusicPlayer = {
  name: 'tiktok',
  playingHere: () => useTikTok.getState().state?.playing ?? false,
  pauseHere: () => command({ action: 'pause' }),
  resumeHere: () => command({ action: 'play' }),
  volume: () => playingVolume() / 100,
  sendVolume: (share) => command({ action: 'volume', percent: Math.round(share * 100) }),
  setVolume: (share) => setVolume(share * 100),
  subscribe: (changed) =>
    useTikTok.subscribe((tiktok, before) => changed(!!tiktok.state?.playing && !before.state?.playing)),
}

/** TikTok with the game (musicWithGame.ts). Returns the function that stops it. */
export function pauseTikTokWithGame(): () => void {
  return pauseMusicWithGame(tiktokPlayer)
}
