/**
 * What WestPlay's Twitch app says, in French or English: French when the game plays in French, English otherwise
 * (as the reports' words: maps/reportWords.ts).
 */
export interface TwitchWords {
  following: string
  popular: string
  loading: string
  noneLive: string
  signInFollowing: string
  signIn: string
  signingIn: string
  signOut: string
  notInHost: string
  back: string
  live: string
  offline: string
  gate: string
  watchAnyway: string
  mute: string
  unmute: string
  volume: string
}

const FR: TwitchWords = {
  following: 'Suivies',
  popular: 'Populaires',
  loading: 'Chargement de Twitch…',
  noneLive: 'Aucune chaîne en direct pour l’instant.',
  signInFollowing:
    'Connecte-toi à Twitch pour voir tes chaînes suivies. La connexion s’ouvre dans une fenêtre sur le bureau du PC.',
  signIn: 'Se connecter',
  signingIn: 'Termine la connexion dans la fenêtre ouverte sur le bureau…',
  signOut: 'Se déconnecter',
  notInHost: 'Twitch ne marche que dans le camion.',
  back: 'Retour aux chaînes',
  live: 'EN DIRECT',
  offline: 'Cette chaîne n’est pas en direct.',
  gate: 'Twitch prévient que ce stream peut contenir du contenu réservé à un public averti.',
  watchAnyway: 'Regarder quand même',
  mute: 'Couper le son',
  unmute: 'Remettre le son',
  volume: 'Volume',
}

const EN: TwitchWords = {
  following: 'Following',
  popular: 'Popular',
  loading: 'Loading Twitch…',
  noneLive: 'No channel live right now.',
  signInFollowing:
    'Sign in to Twitch to see the channels you follow. Signing in opens in a window on the PC’s desktop.',
  signIn: 'Sign in',
  signingIn: 'Finish signing in in the window open on the desktop…',
  signOut: 'Sign out',
  notInHost: 'Twitch only works in the truck.',
  back: 'Back to channels',
  live: 'LIVE',
  offline: 'This channel isn’t live.',
  gate: 'Twitch warns that this stream may have content intended for mature audiences.',
  watchAnyway: 'Watch anyway',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
}

/** The words for the game's language (its `g_lang_init`, e.g. `fr_fr`; `null` until known). */
export function twitchWordsFor(gameLanguage: string | null): TwitchWords {
  return gameLanguage?.toLowerCase().startsWith('fr') ? FR : EN
}
