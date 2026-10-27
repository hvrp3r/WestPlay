/**
 * What WestPlay's X app says, in French or English: French when the game plays in French, English otherwise (as
 * the reports' words: maps/reportWords.ts).
 */
export interface XWords {
  forYou: string
  following: string
  loading: string
  empty: string
  signInTitle: string
  signInText: string
  signIn: string
  signingIn: string
  signOut: string
  notInHost: string
  refresh: string
  back: string
  watch: string
  like: string
  replies: string
  reposts: string
  mute: string
  unmute: string
  volume: string
  /** "3 min", "2 h", "5 d": how long ago. */
  ago: (seconds: number) => string
  /** "Replying to @NASA". */
  replyingTo: (handles: string) => string
  /** The conversation's title. */
  conversation: string
  /** Over the replies to the post opened. */
  answers: string
}

const ago = (minute: string, hour: string, day: string) => (seconds: number) =>
  seconds < 3600
    ? `${Math.max(1, Math.round(seconds / 60))} ${minute}`
    : seconds < 86_400
      ? `${Math.round(seconds / 3600)} ${hour}`
      : `${Math.round(seconds / 86_400)} ${day}`

const FR: XWords = {
  forYou: 'Pour vous',
  following: 'Abonnements',
  loading: 'Chargement de X…',
  empty: 'Aucun post pour l’instant.',
  signInTitle: 'Connecte-toi à X',
  signInText:
    'X n’affiche rien sans compte. La connexion s’ouvre dans une fenêtre sur le bureau du PC, sur la page de X.',
  signIn: 'Se connecter',
  signingIn: 'Termine la connexion dans la fenêtre ouverte sur le bureau…',
  signOut: 'Se déconnecter',
  notInHost: 'X ne marche que dans le camion.',
  refresh: 'Actualiser',
  back: 'Retour au fil',
  watch: 'Regarder la vidéo',
  like: 'J’aime',
  replies: 'Réponses',
  reposts: 'Reposts',
  mute: 'Couper le son',
  unmute: 'Remettre le son',
  volume: 'Volume',
  ago: ago('min', 'h', 'j'),
  replyingTo: (handles) => `En réponse à ${handles}`,
  conversation: 'Conversation',
  answers: 'Réponses',
}

const EN: XWords = {
  forYou: 'For you',
  following: 'Following',
  loading: 'Loading X…',
  empty: 'No posts yet.',
  signInTitle: 'Sign in to X',
  signInText: 'X shows nothing without an account. Signing in opens in a window on the PC’s desktop, on X’s own page.',
  signIn: 'Sign in',
  signingIn: 'Finish signing in in the window open on the desktop…',
  signOut: 'Sign out',
  notInHost: 'X only works in the truck.',
  refresh: 'Refresh',
  back: 'Back to the timeline',
  watch: 'Watch the video',
  like: 'Like',
  replies: 'Replies',
  reposts: 'Reposts',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
  ago: ago('min', 'h', 'd'),
  replyingTo: (handles) => `Replying to ${handles}`,
  conversation: 'Conversation',
  answers: 'Replies',
}

/** The words for the game's language (its `g_lang_init`, e.g. `fr_fr`; `null` until known). */
export function xWordsFor(gameLanguage: string | null): XWords {
  return gameLanguage?.toLowerCase().startsWith('fr') ? FR : EN
}
