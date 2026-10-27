import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { FineInfo } from '../../shared/host'
import {
  type Ahead,
  current,
  type Hotspot,
  keptAhead,
  nextReport,
  type Report,
  reportOfFine,
  reportsAhead,
  type Sighting,
  withHotspot,
  withSightings,
} from './reports'
import { chimeFor, playChime } from './reportSound'
import type { Point } from './route'

/**
 * WestPlay's reports as the cabin has them (reports.ts): the ones there now, the hotspots of past fines, the
 * report coming up on the route (said by ReportAlert) and the last fine's, said for a moment as it comes.
 * Police cars and tow trucks seen in the game's traffic make reports too (receiveSightings).
 * The reports and hotspots are kept across sessions (a police check stays where it was after a restart, as
 * long as its time on the game's clock hasn't run out).
 */

export interface ReportsState {
  reports: Report[]
  hotspots: Hotspot[]
  /** The report coming up on the route, and how far (world m) — `null`: none close. */
  coming: Ahead | null
  /** A fine's report just made, said for a moment (`null`: none). */
  fined: Report | null
  /** A police car (or a tow truck stopped) just seen around the truck, said for a moment whichever way it is:
   * the traffic is only read within some 750 m, so most are beside or behind the truck, never on the route
   * ahead (`null`: none). */
  spotted: Report | null
}

/** A report this far ahead (world m: about a minute at 90 km/h) is said. */
export const SAY_WITHIN = 1500

export const useReports = create<ReportsState>()(
  persist((): ReportsState => ({ reports: [], hotspots: [], coming: null, fined: null, spotted: null }), {
    name: 'westplay.reports',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: ({ reports, hotspots }) => ({ reports, hotspots }),
  }),
)

/** The game's clock, as last seen (in-game minutes; `null`: no telemetry yet). */
let clock: number | null = null

/** The reports already chimed for (reportSound.ts): each is heard once, however long it's said. */
const chimed = new Set<string>()

/** Chimes for `report` the first time it's said. */
function chime(report: Report) {
  if (chimed.has(report.id)) return
  chimed.add(report.id)
  playChime(report.source === 'fine' ? 'fine' : chimeFor(report.kind))
}

/**
 * Looks at the reports again (the live map, every few seconds): the ones run out gone, perhaps a new one on the
 * route ahead (`ahead`: from the truck on; `null` without a route), and the one coming up. `now` is the game's
 * clock.
 */
export function updateReports(ahead: readonly Point[] | null, now: number, random: () => number = Math.random) {
  clock = now
  const state = useReports.getState()
  // Those ahead kept first: one run out just now, still ahead, stays.
  const kept = ahead ? keptAhead(state.reports, ahead, now) : state.reports
  let reports = current(kept, now)
  const added = ahead ? nextReport(ahead, reports, state.hotspots, now, random) : null
  if (added) reports = [...reports, added]
  const next = ahead ? (reportsAhead(reports, ahead).find(({ along }) => along <= SAY_WITHIN) ?? null) : null
  const changed = kept !== state.reports || reports.length !== state.reports.length || added !== null
  const coming = sameComing(state.coming, next) ? state.coming : next
  if (changed || coming !== state.coming) useReports.setState({ ...(changed ? { reports } : {}), coming })
  if (next) chime(next.report)
}

function sameComing(a: Ahead | null, b: Ahead | null): boolean {
  return a?.report.id === b?.report.id && Math.round((a?.along ?? 0) / 50) === Math.round((b?.along ?? 0) / 50)
}

/** How long (ms) a fine's report, or a vehicle just seen, is said as it's made. */
const FINED_SHOWN_MS = 7000
let finedTimer: ReturnType<typeof setTimeout> | undefined
let spottedTimer: ReturnType<typeof setTimeout> | undefined

/** A fine from the game: its report on the map (once, however often it's heard), and its place a hotspot. */
export function receiveFine(fine: FineInfo, random: () => number = Math.random) {
  const report = reportOfFine(fine, random)
  if (!report) return
  const state = useReports.getState()
  if (state.reports.some(({ id }) => id === report.id)) return
  // A fine from before the game's clock now (one sent again from an earlier session) isn't a new one.
  if (clock !== null && report.until <= clock) return
  useReports.setState({
    reports: [...state.reports, report],
    hotspots: withHotspot(state.hotspots, report),
    fined: report,
  })
  chime(report)
  clearTimeout(finedTimer)
  finedTimer = setTimeout(() => useReports.setState({ fined: null }), FINED_SHOWN_MS)
}

/** The police and tow trucks around the truck now (the plugin reads the traffic every second): reported where
 * they're seen, or confirming a report already there; a police car seen stopped makes its place a hotspot. */
export function receiveSightings(sightings: readonly Sighting[], random: () => number = Math.random) {
  if (clock === null || sightings.length === 0) return
  const state = useReports.getState()
  const { reports, made } = withSightings(state.reports, sightings, clock, random)
  const stops = made.filter((report) => report.kind === 'police' && report.stopped)
  // A police check first, then any police car, then a vehicle broken down.
  const spotted = stops[0] ?? made.find((report) => report.kind === 'police') ?? made[0] ?? null
  useReports.setState({
    reports,
    hotspots: stops.reduce((hotspots, report) => withHotspot(hotspots, report), state.hotspots),
    ...(spotted ? { spotted } : {}),
  })
  if (spotted) {
    chime(spotted)
    clearTimeout(spottedTimer)
    spottedTimer = setTimeout(() => useReports.setState({ spotted: null }), FINED_SHOWN_MS)
  }
}
