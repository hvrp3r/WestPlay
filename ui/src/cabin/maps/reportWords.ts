import type { ReportKind } from './reports'

/**
 * What WestPlay's reports say, in French or English: French when the game plays in French, English
 * otherwise (the cabin's other words are WestPlay's, state/strings.ts).
 */
export interface ReportWords {
  kinds: Record<ReportKind, string>
  /** "Reported by DieselFox42". */
  by: (name: string) => string
  /** "12 min ago", on the game's clock. */
  ago: (minutes: number) => string
  /** The player's own fine, as its report is made: "Fined: speeding · €250". */
  fined: (offence: string, amount: string) => string
  /** Under a report from the player's fine. */
  yours: string
  /** Under a report of a vehicle the player came by in the traffic. */
  seen: string
  /** A vehicle just seen around the truck: "135 m away". */
  nearby: (distance: string) => string
  /** A police car seen stopped. */
  check: string
  /** How many others saw it too (a report confirmed). */
  confirmed: (count: number) => string
  offences: Record<string, string>
  thanks: (count: number) => string
}

const FR: ReportWords = {
  kinds: {
    police: 'Police signalée',
    camera: 'Radar signalé',
    accident: 'Accident signalé',
    roadworks: 'Travaux',
    closure: 'Voie fermée',
    hazard: 'Danger sur la route',
    vehicle: 'Véhicule arrêté',
  },
  by: (name) => `Signalé par ${name}`,
  ago: (minutes) =>
    minutes < 1 ? "à l'instant" : minutes < 60 ? `il y a ${minutes} min` : `il y a ${Math.floor(minutes / 60)} h`,
  fined: (offence, amount) => `Amende : ${offence} · ${amount}`,
  yours: 'Ton amende',
  seen: 'Vu sur ta route',
  nearby: (distance) => `À ${distance} de toi`,
  check: 'Contrôle de police',
  confirmed: (count) => `confirmé ${count} fois`,
  offences: {
    speeding: 'excès de vitesse',
    speeding_camera: 'radar',
    red_signal: 'feu rouge',
    crash: 'accident',
    wrong_way: 'contresens',
    no_lights: 'phares éteints',
    avoid_weighing: 'pesée évitée',
    illegal_trailer: 'remorque non conforme',
    avoid_inspection: 'contrôle évité',
    illegal_border_crossing: 'passage de frontière illégal',
    hard_shoulder_violation: "bande d'arrêt d'urgence",
    damaged_vehicle_usage: 'véhicule endommagé',
    generic: 'infraction',
  },
  thanks: (count) => `${count} merci`,
}

const EN: ReportWords = {
  kinds: {
    police: 'Police reported',
    camera: 'Speed camera reported',
    accident: 'Crash reported',
    roadworks: 'Roadworks',
    closure: 'Lane closed',
    hazard: 'Hazard on road',
    vehicle: 'Stopped vehicle',
  },
  by: (name) => `Reported by ${name}`,
  ago: (minutes) =>
    minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`,
  fined: (offence, amount) => `Fined: ${offence} · ${amount}`,
  yours: 'Your fine',
  seen: 'Seen on your way',
  nearby: (distance) => `${distance} away`,
  check: 'Police check',
  confirmed: (count) => `confirmed ${count}×`,
  offences: {
    speeding: 'speeding',
    speeding_camera: 'speed camera',
    red_signal: 'red light',
    crash: 'crash',
    wrong_way: 'wrong way',
    no_lights: 'no lights',
    avoid_weighing: 'weighing avoided',
    illegal_trailer: 'illegal trailer',
    avoid_inspection: 'inspection avoided',
    illegal_border_crossing: 'illegal border crossing',
    hard_shoulder_violation: 'hard shoulder',
    damaged_vehicle_usage: 'damaged vehicle',
    generic: 'offence',
  },
  thanks: (count) => `${count} thanks`,
}

/** The words for the game's language (its `g_lang_init`, e.g. `fr_fr`; `null` until known). */
export function reportWordsFor(gameLanguage: string | null): ReportWords {
  return gameLanguage?.toLowerCase().startsWith('fr') ? FR : EN
}
