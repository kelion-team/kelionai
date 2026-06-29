// Minimal i18n. UI strings per language; English is the fallback for any
// language we don't have a translation for. Add a new language by adding a
// block to `dict` — nothing else changes.

export type Lang = 'en' | 'ro'

export interface Strings {
  tagline: string
  signIn: string
  restricted: string
  signOut: string
  chatHint: string
  chatPlaceholder: string
  send: string
  chatError: string
  brainNotActive: string
  brainError: string
  errClosed: string
  errBadState: string
  errTokenExchange: string
  errNoIdToken: string
  errNoEmail: string
  errGeneric: string
}

const dict: Record<Lang, Strings> = {
  en: {
    tagline: 'Your assistant. Sign in to continue.',
    signIn: 'Sign in with Google',
    restricted: 'Access is restricted. Only authorized accounts may enter.',
    signOut: 'Sign out',
    chatHint: 'Say something to Kelion…',
    chatPlaceholder: 'Type a message…',
    send: 'Send',
    chatError: 'Error.',
    brainNotActive: 'The brain is not active yet (Anthropic key missing).',
    brainError: 'Brain error. Please try again.',
    errClosed: 'Kelionai is currently private. This account does not have access yet.',
    errBadState: 'Login failed (security check). Please try again.',
    errTokenExchange: 'Could not complete Google sign-in. Please try again.',
    errNoIdToken: 'Google did not return an identity. Please try again.',
    errNoEmail: 'Could not read a verified email from Google.',
    errGeneric: 'Sign-in error. Please try again.',
  },
  ro: {
    tagline: 'Asistentul tău. Conectează-te pentru a continua.',
    signIn: 'Conectează-te cu Google',
    restricted: 'Acces restricționat. Doar conturile autorizate pot intra.',
    signOut: 'Deconectare',
    chatHint: 'Spune-i ceva lui Kelion…',
    chatPlaceholder: 'Scrie un mesaj…',
    send: 'Trimite',
    chatError: 'Eroare.',
    brainNotActive: 'Creierul nu e încă activat (lipsește cheia Anthropic).',
    brainError: 'Eroare la creier. Încearcă din nou.',
    errClosed: 'Kelionai este momentan privat. Acest cont nu are încă acces.',
    errBadState: 'Autentificarea a eșuat (verificare de securitate). Încearcă din nou.',
    errTokenExchange: 'Nu am putut finaliza conectarea cu Google. Încearcă din nou.',
    errNoIdToken: 'Google nu a returnat o identitate. Încearcă din nou.',
    errNoEmail: 'Nu am putut citi un email verificat de la Google.',
    errGeneric: 'Eroare la conectare. Încearcă din nou.',
  },
}

const SUPPORTED: Lang[] = ['en', 'ro']

// Resolve any locale string (e.g. "ro-RO", "en-GB") to a supported language.
export function resolveLang(locale: string | undefined | null): Lang {
  const base = (locale ?? 'en').toLowerCase().split('-')[0]
  return (SUPPORTED as string[]).includes(base) ? (base as Lang) : 'en'
}

export function strings(lang: Lang): Strings {
  return dict[lang]
}

// For the login page (before we know the user) — use the browser language.
export function browserLang(): Lang {
  return resolveLang(typeof navigator !== 'undefined' ? navigator.language : 'en')
}
