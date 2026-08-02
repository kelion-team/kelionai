// THE PAGE THEME (Adrian, Aug 2: "vreau să te gândești la un fundal mai
// luminos"). The default is the soft LIGHT palette; the original dark identity
// stays one attribute away (`data-theme="dark"` on <html> — the whole palette
// is CSS variables, no code forks). The choice persists in localStorage so a
// user who prefers the dark keeps it across sessions.
//
// initTheme() runs at import time (Landing and Stage both import this module),
// so the stored choice applies before the first paint on every entry page.

export type ThemeName = 'light' | 'dark'

const STORAGE_KEY = 'kelion-theme'

export function currentTheme(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(name: ThemeName): void {
  try {
    if (name === 'dark') document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    /* no DOM / no storage — the CSS default (light) simply stands */
  }
}

// Flips the theme and returns the NEW one, so a React caller can setState
// straight from the click handler (a re-render also re-reads themeBg()).
export function toggleTheme(): ThemeName {
  const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

// THE CANVAS BACKGROUND, for the 3D scenes: CSS variables drive the page
// theme, but the WebGL clear colour needs a real value — the canvases used to
// hard-code #0b0d12, so on the light theme Kelion sat in a black box over the
// pale page. Read --bg live; the fallback is the light theme's own --bg.
export function themeBg(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#e9edf4'
  } catch {
    return '#e9edf4'
  }
}

// Apply the stored choice as soon as this module loads (both entry pages
// import it, so the attribute is set before first paint).
applyTheme(currentTheme())
