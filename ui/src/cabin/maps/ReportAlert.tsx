import { formatTripDistance } from '../../shared/format'
import { useLive } from '../state/store'
import { useText } from '../state/text'
import { REPORT_COLOURS, REPORT_GLYPHS } from './reportIcons'
import type { Report } from './reports'
import { useReports } from './reportsStore'
import { type ReportWords, reportWordsFor } from './reportWords'
import './reports.css'

/**
 * WestPlay's reports said over the map, Waze's way: the one coming up on the route (its kind, how far, as the
 * game counts distances like the guidance, and who reported it when), and for a moment the report a fine just
 * made ("Fined: speeding · €250") or a police car just seen around the truck ("Police reported · 135 m away").
 */
export function ReportAlert() {
  const coming = useReports((state) => state.coming)
  const fined = useReports((state) => state.fined)
  const spotted = useReports((state) => state.spotted)
  // Each on its own: a new array on every read would draw the alert forever.
  const truckX = useLive((state) => state.telemetry?.x ?? null)
  const truckZ = useLive((state) => state.telemetry?.z ?? null)
  const scale = useLive((state) => state.telemetry?.localScale || 1)
  const now = useLive((state) => state.telemetry?.gameTime ?? 0)
  const words = reportWordsFor(useLive((state) => state.gameLanguage))
  const text = useText()

  if (fined) {
    const offence = words.offences[fined.offence ?? ''] ?? fined.offence ?? ''
    return (
      <aside className="report-alert glass fined" role="status">
        <ReportBadge report={fined} />
        <div>
          <div className="report-title">{words.kinds[fined.kind]}</div>
          <div className="report-detail">{words.fined(offence, formatAmount(fined.amount ?? 0))}</div>
        </div>
      </aside>
    )
  }
  // Coming up on the route says more than seen somewhere around: it goes first.
  if (spotted && !coming) {
    const away = truckX !== null && truckZ !== null ? Math.hypot(spotted.x - truckX, spotted.z - truckZ) : 0
    return (
      <aside className="report-alert glass" role="status">
        <ReportBadge report={spotted} />
        <div>
          <div className="report-title">{titleOf(spotted, words)}</div>
          <div className="report-detail">{words.nearby(formatTripDistance(away * scale, text.decimal))}</div>
        </div>
      </aside>
    )
  }
  if (!coming) return null
  const { report, along } = coming
  return (
    <aside className="report-alert glass" role="status">
      <ReportBadge report={report} />
      <div>
        <div className="report-distance">{formatTripDistance(along * scale, text.decimal)}</div>
        <div className="report-title">{titleOf(report, words)}</div>
        <div className="report-detail">{detailOf(report, now, words)}</div>
      </div>
    </aside>
  )
}

function ReportBadge({ report }: { report: Report }) {
  return (
    <svg className="report-badge" viewBox="0 0 24 24" aria-hidden style={{ background: REPORT_COLOURS[report.kind] }}>
      <path d={REPORT_GLYPHS[report.kind]} fillRule="evenodd" fill={report.kind === 'hazard' ? '#1c1c1e' : '#fff'} />
    </svg>
  )
}

/** "Police reported", or for a police car seen stopped, "Police check". */
function titleOf(report: Report, words: ReportWords): string {
  return report.kind === 'police' && report.source === 'seen' && report.stopped ? words.check : words.kinds[report.kind]
}

/** "Reported by DieselFox42 · 12 min ago · 8 thanks"; for the player's own fine, "Your fine · 1 h ago"; for a
 * vehicle they came by, "Seen on your way · 5 min ago". */
function detailOf(report: Report, now: number, words: ReportWords): string {
  const ago = words.ago(Math.max(0, Math.round(now - report.at)))
  const confirmed = report.thanks > 0 ? ` · ${words.confirmed(report.thanks)}` : ''
  if (report.source === 'seen') return `${words.seen} · ${ago}${confirmed}`
  if (!report.reporter) return `${words.yours} · ${ago}${confirmed}`
  const thanks = report.thanks > 0 ? ` · ${words.thanks(report.thanks)}` : ''
  return `${words.by(report.reporter)} · ${ago}${thanks}`
}

/** A fine's amount in the game's currency (€ in Europe). */
function formatAmount(amount: number): string {
  return `${Math.round(amount).toLocaleString()} €`
}
