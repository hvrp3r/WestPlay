/**
 * What WestPlay's TikTok app says, in French or English: French when the game plays in French, English otherwise
 * (as the reports' words: maps/reportWords.ts).
 */
export interface TikTokWords {
  loading: string
  signInTitle: string
  signInText: string
  signIn: string
  signingIn: string
  signOut: string
  notInHost: string
  like: string
  comments: string
  next: string
  previous: string
  mute: string
  unmute: string
  volume: string
}

const FR: TikTokWords = {
  loading: 'Chargement de TikTok…',
  signInTitle: 'Connecte-toi à TikTok',
  signInText:
    'TikTok demande un compte pour regarder son fil Pour toi. La connexion s’ouvre dans une fenêtre sur le bureau du PC, sur la page de TikTok.',
  signIn: 'Se connecter',
  signingIn: 'Termine la connexion dans la fenêtre ouverte sur le bureau…',
  signOut: 'Se déconnecter',
  notInHost: 'TikTok ne marche que dans le camion.',
  like: 'J’aime',
  comments: 'Commentaires',
  next: 'Vidéo suivante',
  previous: 'Vidéo précédente',
  mute: 'Couper le son',
  unmute: 'Remettre le son',
  volume: 'Volume',
}

const EN: TikTokWords = {
  loading: 'Loading TikTok…',
  signInTitle: 'Sign in to TikTok',
  signInText:
    'TikTok needs an account to watch its For You feed. Signing in opens in a window on the PC’s desktop, on TikTok’s own page.',
  signIn: 'Sign in',
  signingIn: 'Finish signing in in the window open on the desktop…',
  signOut: 'Sign out',
  notInHost: 'TikTok only works in the truck.',
  like: 'Like',
  comments: 'Comments',
  next: 'Next video',
  previous: 'Previous video',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
}

/** The words for the game's language (its `g_lang_init`, e.g. `fr_fr`; `null` until known). */
export function tiktokWordsFor(gameLanguage: string | null): TikTokWords {
  return gameLanguage?.toLowerCase().startsWith('fr') ? FR : EN
}
