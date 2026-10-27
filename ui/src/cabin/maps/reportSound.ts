import type { ReportKind } from './reports'

/**
 * The chime WestPlay's reports are said with, Waze's way: two soft notes rising for most, three urgent ones
 * for the police and cameras, a low double note for a fine. Made here with Web Audio (no files to ship), played
 * through the PC's own sound (the cabin page's, not the truck's speakers the music has).
 */

export type Chime = 'report' | 'police' | 'fine'

/** The notes of each chime: frequency (Hz), when it starts and how long it lasts (s). */
const NOTES: Record<Chime, [frequency: number, start: number, length: number][]> = {
  report: [
    [784, 0, 0.18],
    [1046, 0.16, 0.28],
  ],
  police: [
    [1175, 0, 0.14],
    [880, 0.15, 0.14],
    [1175, 0.3, 0.3],
  ],
  fine: [
    [440, 0, 0.22],
    [330, 0.22, 0.4],
  ],
}

/** How loud the chime is (0 to 1). */
const VOLUME = 0.35

/** The chime for a report of `kind`. */
export function chimeFor(kind: ReportKind): Chime {
  return kind === 'police' || kind === 'camera' ? 'police' : 'report'
}

let context: AudioContext | null = null

/** Plays `chime` now. Silent where the page can't play sound. */
export function playChime(chime: Chime) {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    for (const [frequency, start, length] of NOTES[chime]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      // A soft bell: up at once, then dying away.
      gain.gain.setValueAtTime(0, now + start)
      gain.gain.linearRampToValueAtTime(VOLUME, now + start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + length)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + start)
      oscillator.stop(now + start + length + 0.05)
    }
  } catch {
    // No Web Audio here (tests): nothing to hear.
  }
}
