import { describe, it, expect, beforeEach } from 'vitest'
import {
  getMonitorContent,
  openWorkspaceDoc,
  openWorkspaceApp,
  openWorkspace,
  closeAllTasks,
} from './lib/workspace'

// CE E PE MONITOR (10 aug, ownerul: „nu are acces la ce se afișează pe monitor"):
// get_monitor din creier citește exact ce întoarce getMonitorContent(). Testul
// blochează contractul: conținutul tabului ACTIV, mărginit, cu text/URL corect.
describe('getMonitorContent — conținutul REAL al tabului activ', () => {
  beforeEach(() => closeAllTasks())

  it('monitor gol → null (nu inventează un ecran)', () => {
    expect(getMonitorContent()).toBeNull()
  })

  it('document → felul, titlul și TEXTUL de citit', () => {
    openWorkspaceDoc('Plan de lucru', 'pasul 1: analiză\npasul 2: fix')
    const c = getMonitorContent()
    expect(c?.kind).toBe('doc')
    expect(c?.title).toBe('Plan de lucru')
    expect(c?.text).toContain('pasul 1: analiză')
  })

  it('aplicație (HTML) → textul curățat de taguri, nu markup brut', () => {
    openWorkspaceApp('Mini-app', '<h1>Salut</h1><p>corp <b>real</b></p>')
    const c = getMonitorContent()
    expect(c?.kind).toBe('app')
    expect(c?.text).toContain('Salut')
    expect(c?.text).toContain('corp')
    expect(c?.text).not.toContain('<h1>')
  })

  it('pagină/hartă (URL, fără text) → duce URL-ul, nu inventează conținut', () => {
    openWorkspace('Harta', '/api/route?from=1,2&to=3,4')
    const c = getMonitorContent()
    expect(c?.url).toContain('/api/route')
  })

  it('tabul ACTIV câștigă (ultimul deschis) — conținutul urmează ecranul', () => {
    openWorkspaceDoc('Vechi', 'text vechi')
    openWorkspaceApp('Nou', '<p>text nou</p>')
    const c = getMonitorContent()
    expect(c?.title).toBe('Nou')
    expect(c?.text).toContain('text nou')
  })

  it('textul se mărginește (nu trimite un document uriaș întreg)', () => {
    openWorkspaceDoc('Mare', 'x'.repeat(20000))
    const c = getMonitorContent()
    expect((c?.text?.length ?? 0)).toBeLessThanOrEqual(8000)
  })

  it('gestionează conținut gol sau caractere speciale fără erori', () => {
    openWorkspaceDoc('Doc Gol', '')
    const c = getMonitorContent()
    expect(c?.title).toBe('Doc Gol')
    expect(c?.text).toBe('')
  })
})
