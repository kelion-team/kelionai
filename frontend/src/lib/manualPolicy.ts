export const MANUAL_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
  { code: 'ro', label: 'Română' },
  { code: 'ko', label: '한국어' },
] as const

export type ManualLanguage = (typeof MANUAL_LANGUAGES)[number]['code']

interface ManualChrome {
  searchPlaceholder: string
  searchLabel: string
  languageLabel: string
  download: string
  translating: string
  noMatches: string
  turnHint: string
  previousPage: string
  nextPage: string
}

const CHROME: Record<ManualLanguage, ManualChrome> = {
  en: {
    searchPlaceholder: 'Search…',
    searchLabel: 'Search the manual',
    languageLabel: 'Language',
    download: 'Download',
    translating: 'Translating… showing English until it is ready.',
    noMatches: 'No matches',
    turnHint: '← → turn the page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
  },
  fr: {
    searchPlaceholder: 'Rechercher…',
    searchLabel: 'Rechercher dans le manuel',
    languageLabel: 'Langue',
    download: 'Télécharger',
    translating: "Traduction… l'anglais reste affiché jusqu'à la fin.",
    noMatches: 'Aucun résultat',
    turnHint: '← → tourner la page',
    previousPage: 'Page précédente',
    nextPage: 'Page suivante',
  },
  de: {
    searchPlaceholder: 'Suchen…',
    searchLabel: 'Handbuch durchsuchen',
    languageLabel: 'Sprache',
    download: 'Herunterladen',
    translating: 'Übersetzung läuft… bis dahin wird Englisch angezeigt.',
    noMatches: 'Keine Treffer',
    turnHint: '← → Seite umblättern',
    previousPage: 'Vorherige Seite',
    nextPage: 'Nächste Seite',
  },
  es: {
    searchPlaceholder: 'Buscar…',
    searchLabel: 'Buscar en el manual',
    languageLabel: 'Idioma',
    download: 'Descargar',
    translating: 'Traduciendo… se muestra inglés hasta que termine.',
    noMatches: 'Sin resultados',
    turnHint: '← → pasar la página',
    previousPage: 'Página anterior',
    nextPage: 'Página siguiente',
  },
  it: {
    searchPlaceholder: 'Cerca…',
    searchLabel: 'Cerca nel manuale',
    languageLabel: 'Lingua',
    download: 'Scarica',
    translating: "Traduzione… nel frattempo viene mostrato l'inglese.",
    noMatches: 'Nessun risultato',
    turnHint: '← → gira pagina',
    previousPage: 'Pagina precedente',
    nextPage: 'Pagina successiva',
  },
  ru: {
    searchPlaceholder: 'Поиск…',
    searchLabel: 'Поиск по руководству',
    languageLabel: 'Язык',
    download: 'Скачать',
    translating: 'Перевод… до завершения показан английский текст.',
    noMatches: 'Совпадений нет',
    turnHint: '← → перелистнуть страницу',
    previousPage: 'Предыдущая страница',
    nextPage: 'Следующая страница',
  },
  ro: {
    searchPlaceholder: 'Caută…',
    searchLabel: 'Caută în manual',
    languageLabel: 'Limbă',
    download: 'Descarcă',
    translating: 'Se traduce… până la final este afișată versiunea în engleză.',
    noMatches: 'Niciun rezultat',
    turnHint: '← → întoarce pagina',
    previousPage: 'Pagina anterioară',
    nextPage: 'Pagina următoare',
  },
  ko: {
    searchPlaceholder: '검색…',
    searchLabel: '사용 설명서 검색',
    languageLabel: '언어',
    download: '다운로드',
    translating: '번역 중… 완료될 때까지 영어가 표시됩니다.',
    noMatches: '검색 결과 없음',
    turnHint: '← → 페이지 넘기기',
    previousPage: '이전 페이지',
    nextPage: '다음 페이지',
  },
}

export function resolveManualLanguage(value: unknown): ManualLanguage {
  const candidate = String(value ?? '').trim().toLowerCase()
  return MANUAL_LANGUAGES.some(({ code }) => code === candidate)
    ? candidate as ManualLanguage
    : 'en'
}

export function manualChrome(language: ManualLanguage): ManualChrome {
  return CHROME[language]
}

export interface ManualAudienceSection {
  title: string
  audience?: 'public' | 'admin'
}

const LEGACY_ADMIN_TITLE = /^\s*(?:🔒\s*)?(?:doar\s+admin|admin(?:istrator)?[-\s]+only)\b/iu

/**
 * Backend authorization remains authoritative. This filter prevents a stale or
 * malformed public response from rendering administrator chapters in the book.
 */
export function manualSectionsForAudience<T extends ManualAudienceSection>(
  sections: readonly T[],
  isAdmin: boolean,
): T[] {
  return sections.filter((section) => {
    if (section.audience === 'admin') return isAdmin
    if (section.audience !== undefined && section.audience !== 'public') return false
    return isAdmin || !LEGACY_ADMIN_TITLE.test(section.title)
  })
}
