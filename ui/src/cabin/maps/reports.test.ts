import { describe, expect, it } from 'vitest'
import type { FineInfo } from '../../shared/host'
import {
  alongLine,
  current,
  KEEP_AHEAD,
  keptAhead,
  kindOfOffence,
  nextReport,
  type Report,
  reportOfFine,
  reportsAhead,
  type Sighting,
  SPAWN_FROM,
  withHotspot,
  withSightings,
} from './reports'
import type { Point } from './route'

// A straight route east along z = 0, 20 km long.
const route: Point[] = [
  [0, 0],
  [20_000, 0],
]

/** Always the same draw: below every chance, so whatever may happen does. */
const always = () => 0
/** Draws in turn from `values`, round and round. */
const draws = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

const fine = (offence: string, x = 5000, z = 0): FineInfo => ({ count: 1, offence, amount: 250, x, z, gameTime: 600 })

const report = (x: number, z: number, extra: Partial<Report> = {}): Report => ({
  id: `r${x},${z}`,
  kind: 'police',
  x,
  z,
  source: 'community',
  reporter: 'DieselFox42',
  at: 500,
  until: 700,
  thanks: 0,
  ...extra,
})

describe('fines', () => {
  it('make the report their offence says', () => {
    expect(kindOfOffence('speeding')).toBe('police')
    expect(kindOfOffence('red_signal')).toBe('police')
    expect(kindOfOffence('speeding_camera')).toBe('camera')
    expect(kindOfOffence('crash')).toBe('accident')
    expect(kindOfOffence('avoid_sleeping')).toBeNull()
  })

  it('are reported where and when they were given, by the player', () => {
    const made = reportOfFine(fine('speeding'), always)
    expect(made).toMatchObject({ id: 'fine-1-600', kind: 'police', x: 5000, z: 0, source: 'fine', reporter: null })
    expect(made!.until).toBeGreaterThan(600)
    expect(reportOfFine(fine('avoid_sleeping'), always)).toBeNull()
  })

  it('count for the hotspot they are at, or make one', () => {
    const first = withHotspot([], reportOfFine(fine('speeding'), always)!)
    expect(first).toEqual([{ x: 5000, z: 0, kind: 'police', fines: 1 }])
    const again = withHotspot(first, reportOfFine(fine('speeding', 5100, 50), always)!)
    expect(again).toEqual([{ x: 5000, z: 0, kind: 'police', fines: 2 }])
    const elsewhere = withHotspot(again, reportOfFine(fine('speeding', 9000), always)!)
    expect(elsewhere).toHaveLength(2)
    // A crash is no place the police wait at.
    expect(withHotspot([], reportOfFine(fine('crash'), always)!)).toEqual([])
  })
})

describe('current', () => {
  it('lets go of reports run out, and of those from later than now', () => {
    const reports = [report(1, 0), report(2, 0, { until: 550 }), report(3, 0, { at: 650 })]
    expect(current(reports, 600).map(({ x }) => x)).toEqual([1])
  })
})

describe('reportsAhead', () => {
  it('finds the reports on the route, nearest first, by how far along it', () => {
    const found = reportsAhead([report(8000, 5), report(3000, -4), report(5000, 200)], route)
    expect(found.map(({ report: { x }, along }) => [x, Math.round(along)])).toEqual([
      [3000, 3000],
      [8000, 8000],
    ])
  })

  it('gives nothing past the line', () => {
    expect(alongLine(route, [-500, 0], 15)).toBeNull()
  })
})

describe('nextReport', () => {
  it('puts one somewhere along the route ahead, past where the truck could see it appear', () => {
    const made = nextReport(route, [], [], 600, draws(0, 0.5, 0.5, 0.2, 0.3, 0.4, 0.5))
    expect(made).not.toBeNull()
    expect(made!.source).toBe('community')
    expect(made!.reporter).toBeTruthy()
    expect(made!.x).toBeGreaterThanOrEqual(SPAWN_FROM)
    expect(Math.abs(made!.z)).toBeLessThan(1)
    expect(made!.at).toBeLessThanOrEqual(600)
    expect(made!.until).toBeGreaterThan(600)
  })

  it('makes none while the route ahead has its share', () => {
    const full = [report(6000, 0), report(12_000, 0)]
    expect(nextReport(route, full, [], 600, always)).toBeNull()
  })

  it('makes none on a route too short to put one out of sight', () => {
    expect(
      nextReport(
        [
          [0, 0],
          [SPAWN_FROM - 1, 0],
        ],
        [],
        [],
        600,
        always,
      ),
    ).toBeNull()
  })

  it('makes none most of the time', () => {
    expect(nextReport(route, [], [], 600, () => 0.99)).toBeNull()
  })

  it('sends the police to a hotspot the route passes', () => {
    // The draws: the chance (0), the kind (0: police, first in line), the place along (0.5), the hotspot
    // chance (0), the hotspot picked (0), then the times and the name.
    const made = nextReport(
      route,
      [],
      [{ x: 15_000, z: 30, kind: 'police', fines: 3 }],
      600,
      draws(0, 0, 0.5, 0, 0, 0.5),
    )
    expect(made).toMatchObject({ kind: 'police', x: 15_000, z: 30 })
  })
})

describe('withSightings', () => {
  const police = (x: number, speed: number, id = 'p1'): Sighting => ({ id, kind: 'police', x, z: 0, speed })
  const tow = (x: number, speed: number): Sighting => ({ id: 't1', kind: 'tow', x, z: 0, speed })

  it('reports a police car where it is first seen, driving by or stopped', () => {
    const driving = withSightings([], [police(1000, 30)], 600, always)
    expect(driving.reports).toMatchObject([{ kind: 'police', x: 1000, source: 'seen', vehicle: 'p1', stopped: false }])
    const stopped = withSightings([], [police(1000, 0)], 600, always)
    expect(stopped.made).toMatchObject([{ kind: 'police', stopped: true }])
  })

  it('keeps one report for a police car driving on, however far it goes', () => {
    const first = withSightings([], [police(1000, 30)], 600, always).reports
    const later = withSightings(first, [police(5000, 30)], 601, always)
    expect(later.reports).toHaveLength(1)
    expect(later.reports[0].x).toBe(1000)
    expect(later.made).toEqual([])
  })

  it('reports a police car anew where it stops, away from where it drove by', () => {
    const first = withSightings([], [police(1000, 30)], 600, always).reports
    const stopped = withSightings(first, [police(5000, 0)], 610, always)
    expect(stopped.reports).toHaveLength(2)
    expect(stopped.made).toMatchObject([{ x: 5000, stopped: true }])
  })

  it('confirms a report of its kind already there rather than making another', () => {
    const community = report(1100, 0, { until: 620 })
    const seen = withSightings([community], [police(1000, 0)], 600, always)
    expect(seen.reports).toHaveLength(1)
    expect(seen.reports[0]).toMatchObject({ id: community.id, thanks: 1, vehicle: 'p1' })
    expect(seen.reports[0].until).toBeGreaterThan(620)
  })

  it('reports a tow truck only once it stands', () => {
    expect(withSightings([], [tow(1000, 20)], 600, always).reports).toEqual([])
    expect(withSightings([], [tow(1000, 0)], 600, always).reports).toMatchObject([{ kind: 'vehicle', x: 1000 }])
  })
})

describe('keptAhead', () => {
  it('keeps the reports on the route ahead until the truck passes them', () => {
    const ahead = report(9000, 0, { until: 605 })
    const aside = report(9000, 500, { until: 605 })
    const kept = keptAhead([ahead, aside], route, 600)
    expect(kept[0].until).toBe(600 + KEEP_AHEAD)
    expect(kept[1].until).toBe(605)
  })

  it('leaves the reports alone when none needs it', () => {
    const reports = [report(9000, 0, { until: 900 })]
    expect(keptAhead(reports, route, 600)).toBe(reports)
  })
})
