import type { FineInfo } from '../../shared/host'
import type { Point } from './route'

/**
 * WestPlay's reports, Waze's way, for a player driving alone: police, speed cameras, accidents, roadworks,
 * closed lanes, things on the road and stopped vehicles, shown on the map and said as the truck comes up to
 * them. Nobody else reports them: a made-up community does, along the route ahead (each with a reporter's
 * name and the thanks it got), and the game itself, through the player's fines (a police check where they
 * were fined for speeding, a camera where it flashed, their own accident where they crashed) and its traffic:
 * the police cars and tow trucks around the truck, read from the game's memory (the plugin's traffic.rs), are
 * reported where they're seen, and a report already there is confirmed rather than made twice. The places
 * of past fines and of police seen stopped are remembered (hotspots), and the community's police come back to
 * them more often than elsewhere.
 *
 * Everything here is plain: the time is the game's (in-game minutes, the telemetry's `gameTime`, so a
 * report waits while the game is paused), distances are the world's metres (x east, z south), and the
 * randomness is passed in (tests give their own).
 */

export const REPORT_KINDS = ['police', 'camera', 'accident', 'roadworks', 'closure', 'hazard', 'vehicle'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

/** Who made a report: the made-up community, or the game (one of the player's fines, or a vehicle of its
 * traffic seen around the truck). */
export type ReportSource = 'community' | 'fine' | 'seen'

export interface Report {
  id: string
  kind: ReportKind
  x: number
  z: number
  source: ReportSource
  /** The reporter's name (`null`: the player's own fine, or seen by the player). */
  reporter: string | null
  /** When it was reported and when it goes, in-game minutes. */
  at: number
  until: number
  /** How many thanked the reporter (the community's), for show. */
  thanks: number
  /** A fine's: the SDK's offence (`speeding`...) and its amount, in the game's currency. */
  offence?: string
  amount?: number
  /** Seen in the traffic: the vehicle (the game's object for it, while it's around), and whether it was
   * stopped (a police check, a breakdown) or only driving by. */
  vehicle?: string
  stopped?: boolean
}

/** Where the player was fined before, or saw the police stopped: the police come back here more often. */
export interface Hotspot {
  x: number
  z: number
  kind: ReportKind
  /** Fines (and police stops seen) here so far. */
  fines: number
}

/** How likely each kind is among the community's reports (out of their sum). */
const KIND_WEIGHTS: Record<ReportKind, number> = {
  police: 30,
  camera: 8,
  accident: 12,
  roadworks: 18,
  closure: 5,
  hazard: 15,
  vehicle: 12,
}

/** How long each kind stays, in-game minutes, shortest and longest. The game's clock runs about 20 times
 * faster than the player's own outside the menu: 90 in-game minutes are some 4 or 5 real ones. */
export const LIFETIMES: Record<ReportKind, [number, number]> = {
  police: [90, 240],
  camera: [120, 360],
  accident: [60, 180],
  roadworks: [600, 2400],
  closure: [240, 720],
  hazard: [30, 120],
  vehicle: [30, 90],
}

/** A fine's report stays longer than the community's: the player saw it themselves. */
const FINE_LIFETIME = 2

/** How far (m) from the route's line a report can be and still be on its road (its lanes either way). */
export const ON_ROAD = 15
/** Reports appear no closer than this (m) along the route ahead: never right in front of the truck. */
export const SPAWN_FROM = 4000
/** How many community reports the route ahead holds at most, per 10 km of it. */
export const DENSITY = 1.2
/** The chance, each time the reports are looked at (every few seconds), that one more appears while the
 * route ahead has room for it. */
export const SPAWN_CHANCE = 0.08
/** How near (m) to a hotspot the route must pass for the police to be likelier there. */
const HOTSPOT_REACH = 400
/** The chance a new police report goes to a hotspot on the route ahead, rather than anywhere along it. */
const HOTSPOT_CHANCE = 0.5
/** A fine within this distance (m) of a hotspot counts for it, rather than making a new one. */
const SAME_HOTSPOT = 300
/** The most hotspots kept (the oldest let go of). */
export const HOTSPOTS_KEPT = 200

/** Which report a fine's offence makes (none: an offence that says nothing about the road, as sleeping). */
export function kindOfOffence(offence: string): ReportKind | null {
  switch (offence) {
    case 'speeding_camera':
      return 'camera'
    case 'crash':
      return 'accident'
    case 'avoid_sleeping':
      return null
    default:
      // Speeding, a red light, the wrong way, no lights, weighing or an inspection avoided, the hard
      // shoulder, a border crossed where it mustn't be...: the police stopped the player there.
      return 'police'
  }
}

/** The report a fine makes (none for an offence that says nothing about the road). Its id is the fine's
 * own (its count and time), so a fine heard twice makes it once. */
export function reportOfFine(fine: FineInfo, random: () => number): Report | null {
  const kind = kindOfOffence(fine.offence)
  if (!kind) return null
  const [shortest, longest] = LIFETIMES[kind]
  return {
    id: `fine-${fine.count}-${fine.gameTime}`,
    kind,
    x: fine.x,
    z: fine.z,
    source: 'fine',
    reporter: null,
    at: fine.gameTime,
    until: fine.gameTime + (shortest + random() * (longest - shortest)) * FINE_LIFETIME,
    thanks: 0,
    offence: fine.offence,
    amount: fine.amount,
  }
}

/** The hotspots with a fine's place (or a police stop's) added: counted for the one it's at, or a new one. */
export function withHotspot(hotspots: readonly Hotspot[], report: Report): Hotspot[] {
  if (report.kind !== 'police' && report.kind !== 'camera') return [...hotspots]
  const near = hotspots.findIndex(
    (spot) => spot.kind === report.kind && Math.hypot(spot.x - report.x, spot.z - report.z) <= SAME_HOTSPOT,
  )
  if (near >= 0) return hotspots.map((spot, i) => (i === near ? { ...spot, fines: spot.fines + 1 } : spot))
  return [...hotspots, { x: report.x, z: report.z, kind: report.kind, fines: 1 }].slice(-HOTSPOTS_KEPT)
}

/** A vehicle of note in the game's traffic around the truck (the plugin's traffic.rs): which one, what it is,
 * where (world m) and how fast (m/s). */
export interface Sighting {
  id: string
  kind: 'police' | 'tow'
  x: number
  z: number
  speed: number
}

/** Below this speed (m/s, some 7 km/h) a vehicle seen is stopped. */
export const STOPPED_BELOW = 2
/** A sighting within this distance (m) of a report of its kind confirms it rather than making another. */
export const SAME_PLACE = 300
/** How long a police car only driving by is reported for, in-game minutes (it won't be there long). */
export const DRIVING_BY: [number, number] = [20, 40]

/** What happened as the traffic was looked at: the reports now, and the reports new or newly stopped (their
 * places hotspots). */
export interface Sighted {
  reports: Report[]
  made: Report[]
}

/**
 * The reports with what's seen in the traffic around the truck at `now`: a police car is reported where it's
 * first seen (driving by, for a short while; stopped, as a police check), a tow truck only stopped (a vehicle
 * broken down). The same vehicle seen again keeps its report going (once it stops away from it, a new report
 * says where); a report of the kind already near (the community's, a fine's) is confirmed: it lasts on, with
 * one thanks more.
 */
export function withSightings(
  reports: readonly Report[],
  sightings: readonly Sighting[],
  now: number,
  random: () => number,
): Sighted {
  const next = [...reports]
  const made: Report[] = []
  for (const sighting of sightings) {
    const stopped = sighting.speed < STOPPED_BELOW
    const kind: ReportKind | null = sighting.kind === 'police' ? 'police' : stopped ? 'vehicle' : null
    if (!kind) continue
    const [shortest, longest] = stopped ? LIFETIMES[kind] : DRIVING_BY
    const until = now + shortest + random() * (longest - shortest)
    const near = (report: Report) => Math.hypot(report.x - sighting.x, report.z - sighting.z) <= SAME_PLACE
    const own = next.findIndex((report) => report.vehicle === sighting.id && (near(report) || !stopped))
    const confirmed = own >= 0 ? own : next.findIndex((report) => report.kind === kind && near(report))
    if (confirmed >= 0) {
      const report = next[confirmed]
      const seenAgain = report.vehicle === sighting.id
      next[confirmed] = {
        ...report,
        until: Math.max(report.until, until),
        thanks: report.thanks + (seenAgain ? 0 : 1),
        vehicle: report.vehicle ?? sighting.id,
        stopped: report.stopped || stopped,
      }
      // A police car seen stopped, driving by when first reported: now a police check, where it stands.
      if (seenAgain && stopped && !report.stopped) made.push(next[confirmed])
      continue
    }
    const report: Report = {
      id: `seen-${sighting.id}-${Math.round(now)}`,
      kind,
      x: sighting.x,
      z: sighting.z,
      source: 'seen',
      reporter: null,
      at: now,
      until,
      thanks: 0,
      vehicle: sighting.id,
      stopped,
    }
    next.push(report)
    made.push(report)
  }
  return { reports: next, made }
}

/** A report on the route ahead lasts at least this much longer (in-game minutes, about a real minute), each
 * time it's looked at: the community puts them up to 25 km ahead, a quarter of an hour's drive, longer than
 * most last. */
export const KEEP_AHEAD = 20

/** The reports with those on the route ahead (`ahead`: from the truck on) kept until the truck has passed
 * them, as Waze's stay on the road until someone says they're gone. The same array when none needed it. */
export function keptAhead(reports: Report[], ahead: readonly Point[], now: number): Report[] {
  const ids = new Set(
    reportsAhead(reports, ahead)
      .filter(({ report }) => report.until < now + KEEP_AHEAD)
      .map(({ report }) => report.id),
  )
  if (ids.size === 0) return reports
  return reports.map((report) => (ids.has(report.id) ? { ...report, until: now + KEEP_AHEAD } : report))
}

/** The reports still there at `now`. One from later than now (a save loaded from before it) goes too. */
export function current(reports: readonly Report[], now: number): Report[] {
  return reports.filter((report) => report.until > now && report.at <= now)
}

/** A report on the route: how far along it (m from its start, the truck). */
export interface Ahead {
  report: Report
  along: number
}

/** The reports on the route's line (`line` from the truck on), nearest first, with how far along it each is. */
export function reportsAhead(reports: readonly Report[], line: readonly Point[]): Ahead[] {
  const found: Ahead[] = []
  for (const report of reports) {
    const along = alongLine(line, [report.x, report.z], ON_ROAD)
    if (along !== null) found.push({ report, along })
  }
  return found.sort((a, b) => a.along - b.along)
}

/** How far along `line` (m) its nearest point to `point` is, if `point` is within `reach` of it. */
export function alongLine(line: readonly Point[], point: Point, reach: number): number | null {
  let best: { distance: number; along: number } | null = null
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
    const length = Math.hypot(dx, dz)
    const t = length > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length ** 2)) : 0
    const distance = Math.hypot(a[0] + dx * t - point[0], a[1] + dz * t - point[1])
    if (distance <= reach && (!best || distance < best.distance)) best = { distance, along: travelled + length * t }
    travelled += length
  }
  return best?.along ?? null
}

/** The point `metres` along `line` (its end if it's shorter). */
export function pointAlong(line: readonly Point[], metres: number): Point {
  let left = metres
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length >= left) {
      const t = length > 0 ? left / length : 0
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    left -= length
  }
  return line[line.length - 1]
}

export function lineLength(line: readonly Point[]): number {
  let length = 0
  for (let i = 1; i < line.length; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
  return length
}

/**
 * The community's next report on the route ahead (`ahead`: from the truck on), if one comes now: while the
 * route ahead holds fewer than its share ([`DENSITY`]), now and then ([`SPAWN_CHANCE`]) one more appears
 * somewhere past [`SPAWN_FROM`]. The police go to a hotspot the route passes half the time there's one.
 */
export function nextReport(
  ahead: readonly Point[],
  reports: readonly Report[],
  hotspots: readonly Hotspot[],
  now: number,
  random: () => number,
): Report | null {
  const length = lineLength(ahead)
  if (length <= SPAWN_FROM) return null
  const onRoute = reportsAhead(
    reports.filter((report) => report.source === 'community'),
    ahead,
  ).length
  if (onRoute >= Math.max(1, Math.floor((length / 10_000) * DENSITY))) return null
  if (random() >= SPAWN_CHANCE) return null

  const kind = pickKind(random)
  let at: Point = pointAlong(ahead, SPAWN_FROM + random() * (length - SPAWN_FROM))
  if (kind === 'police' || kind === 'camera') {
    const spots = hotspots.filter((spot) => {
      const along = spot.kind === kind ? alongLine(ahead, [spot.x, spot.z], HOTSPOT_REACH) : null
      return along !== null && along >= SPAWN_FROM
    })
    if (spots.length > 0 && random() < HOTSPOT_CHANCE) {
      // The spots fined most often first in line.
      const total = spots.reduce((sum, spot) => sum + spot.fines, 0)
      let pick = random() * total
      const spot = spots.find((candidate) => (pick -= candidate.fines) < 0) ?? spots[spots.length - 1]
      at = [spot.x, spot.z]
    }
  }
  const [shortest, longest] = LIFETIMES[kind]
  // Reported a little while ago already: a report seen coming up has been there a few minutes.
  const age = random() * 0.3 * shortest
  return {
    id: `community-${Math.round(now)}-${Math.floor(random() * 1e9).toString(36)}`,
    kind,
    x: at[0],
    z: at[1],
    source: 'community',
    reporter: reporterName(random),
    at: now - age,
    until: now - age + shortest + random() * (longest - shortest),
    thanks: Math.floor(random() ** 2 * 25),
  }
}

function pickKind(random: () => number): ReportKind {
  const total = REPORT_KINDS.reduce((sum, kind) => sum + KIND_WEIGHTS[kind], 0)
  let pick = random() * total
  return REPORT_KINDS.find((kind) => (pick -= KIND_WEIGHTS[kind]) < 0) ?? 'hazard'
}

const NAME_STARTS = [
  'Routier',
  'Trucker',
  'Kamion',
  'Diesel',
  'Convoy',
  'Euro',
  'Night',
  'Big',
  'Road',
  'Iron',
  'Volvo',
  'Scania',
]
const NAME_ENDS = ['Wolf', 'Rider', 'Max', 'King', 'Fox', 'Joe', 'Pilot', 'Lou', 'Bear', 'Hawk', 'Duc', 'Star']

/** A made-up reporter: "DieselFox42". */
export function reporterName(random: () => number): string {
  const pick = (names: string[]) => names[Math.floor(random() * names.length)]
  const number = random() < 0.6 ? String(Math.floor(random() * 99) + 1) : ''
  return `${pick(NAME_STARTS)}${pick(NAME_ENDS)}${number}`
}
