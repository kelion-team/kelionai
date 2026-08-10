import React, { useState, useEffect, useRef } from 'react'

// Adaptare CV — REALĂ (Adrian, 10 aug): căutare Google reală (Serper),
// adaptare cu lanțul de agenți, încărcare CV în orice format. Fără joburi
// hardcodate. Doar useri plătitori (poarta e pe server).
interface Job {
  id: string
  platform: string
  title: string
  link: string
  description: string
}

interface Pas { agent: string; nume: string; ok: boolean; text: string }

interface CvAdaptationProps {
  onClose: () => void
}

export default function CvAdaptation({ onClose }: CvAdaptationProps): React.ReactElement {
  const [activeSubTab, setActiveSubTab] = useState<'search' | 'custom'>('search')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['linkedin', 'indeed', 'cv_library'])
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [searchNote, setSearchNote] = useState('')
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [searching, setSearching] = useState(false)

  const [jobLink, setJobLink] = useState('')
  const [jobDescription, setJobDescription] = useState('')

  const [cvImplicit, setCvImplicit] = useState('')
  const [savingCv, setSavingCv] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [adapting, setAdapting] = useState(false)
  const [adaptedCv, setAdaptedCv] = useState('')
  const [verificare, setVerificare] = useState('')
  const [plan, setPlan] = useState('')
  const [pasi, setPasi] = useState<Pas[]>([])
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    fetch('/api/jobs/cv-implicit')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load'))))
      .then((data) => { if (data.cv) setCvImplicit(data.cv) })
      .catch(() => setErrorMessage('Nu s-a putut încărca CV-ul salvat.'))
  }, [])

  const togglePlatform = (p: string): void =>
    setSelectedPlatforms((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))
  const toggleJob = (id: string): void =>
    setSelectedJobIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const handleSearch = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSearching(true); setErrorMessage(''); setSearchNote('')
    try {
      const res = await fetch('/api/jobs/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchTerm, platforms: selectedPlatforms, salaryMin: salaryMin || undefined, salaryMax: salaryMax || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMessage(data.error || 'Eroare la căutare'); setJobs([]); return }
      setJobs(data.jobs || [])
      setSelectedJobIds([])
      if (data.nota) setSearchNote(data.nota)
    } catch {
      setErrorMessage('A apărut o eroare de rețea la căutare.')
    } finally {
      setSearching(false)
    }
  }

  const handleSaveCv = async (): Promise<void> => {
    setSavingCv(true); setErrorMessage(''); setSuccessMessage('')
    try {
      const res = await fetch('/api/jobs/cv-implicit', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: cvImplicit }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMessage(data.error || 'Eroare la salvare'); return }
      setSuccessMessage('CV-ul a fost salvat.')
    } catch {
      setErrorMessage('Nu s-a putut salva CV-ul.')
    } finally {
      setSavingCv(false)
    }
  }

  // Încărcare CV în ORICE format: text/PDF/imagine (serverul extrage cu Gemini).
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true); setErrorMessage(''); setSuccessMessage('')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const rd = new FileReader()
        rd.onload = () => resolve(String(rd.result).split(',')[1] ?? '')
        rd.onerror = () => reject(new Error('citire'))
        rd.readAsDataURL(f)
      })
      const res = await fetch('/api/jobs/cv-incarca', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nume: f.name, mime: f.type, base64 }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMessage(data.error || 'Eroare la încărcare'); return }
      if (data.cv) setCvImplicit(data.cv)
      setSuccessMessage(data.message || 'CV-ul a fost citit și salvat.')
    } catch {
      setErrorMessage('Nu s-a putut citi fișierul.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleAdapt = async (): Promise<void> => {
    setAdapting(true); setErrorMessage(''); setSuccessMessage('')
    setAdaptedCv(''); setVerificare(''); setPlan(''); setPasi([])

    const body: Record<string, unknown> = { cvContent: cvImplicit }
    if (activeSubTab === 'search') {
      if (selectedJobIds.length === 0) {
        setErrorMessage('Selectează cel puțin un job din rezultate.'); setAdapting(false); return
      }
      body.jobs = jobs.filter((j) => selectedJobIds.includes(j.id))
        .map((j) => ({ title: j.title, link: j.link, platform: j.platform, description: j.description }))
    } else {
      if (!jobDescription && !jobLink) {
        setErrorMessage('Dă un link sau o descriere de job.'); setAdapting(false); return
      }
      body.jobDescription = jobDescription
      body.jobLink = jobLink
    }

    try {
      const res = await fetch('/api/jobs/adapt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMessage(data.error || 'Eroare la adaptare'); if (data.pasi) setPasi(data.pasi); return }
      setAdaptedCv(data.adaptedCv || '')
      setVerificare(data.verificare || '')
      setPlan(data.plan || '')
      setPasi(data.pasi || [])
      setSuccessMessage(data.message || 'Adaptare gata.')
    } catch {
      setErrorMessage('A apărut o eroare de rețea la adaptare.')
    } finally {
      setAdapting(false)
    }
  }

  const rezultatComplet = [
    adaptedCv,
    verificare && `\n\n=== VERIFICARE ===\n${verificare}`,
    plan && `\n\n=== PLAN DE APLICARE & INTERVIU ===\n${plan}`,
  ].filter(Boolean).join('')

  const box: React.CSSProperties = { backgroundColor: '#25262b', padding: '15px', borderRadius: '6px', border: '1px solid #2c2e33' }
  const input: React.CSSProperties = { width: '100%', backgroundColor: '#1a1b1e', color: '#fff', border: '1px solid #373a40', borderRadius: '4px', padding: '8px 12px', fontSize: '0.9rem' }

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1e1e24', borderRadius: '8px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid #3a3a4a', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #3a3a4a', paddingBottom: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#4dabf7' }}>Adaptare CV Inteligentă</h2>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
      </div>

      {errorMessage && <div style={{ backgroundColor: '#f03e3e22', color: '#f03e3e', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #f03e3e55' }}>{errorMessage}</div>}
      {successMessage && <div style={{ backgroundColor: '#37b24d22', color: '#37b24d', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #37b24d55' }}>{successMessage}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={box}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>CV-ul Tău (Sursă)</h3>
            <p style={{ fontSize: '0.85rem', color: '#909296', margin: '0 0 10px 0' }}>
              CV-ul de bază care va fi adaptat pe joburile selectate. Îl poți scrie aici sau încărca un fișier (text, PDF sau poză).
            </p>
            <input ref={fileRef} type="file" accept=".txt,.md,.csv,.pdf,image/*,application/pdf" onChange={handleUpload} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ marginBottom: '10px', backgroundColor: '#495057', color: '#fff', border: 'none', borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}>
              {uploading ? 'Se citește fișierul...' : '📎 Încarcă CV (text / PDF / poză)'}
            </button>
            <textarea value={cvImplicit} onChange={(e) => setCvImplicit(e.target.value)} style={{ ...input, height: '220px', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical' }} placeholder="Scrie sau încarcă CV-ul tău aici..." />
            <button onClick={handleSaveCv} disabled={savingCv} style={{ marginTop: '10px', backgroundColor: '#228be6', color: '#fff', border: 'none', borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}>
              {savingCv ? 'Se salvează...' : 'Salvează CV-ul'}
            </button>
          </div>

          <div style={box}>
            <div style={{ display: 'flex', borderBottom: '1px solid #373a40', marginBottom: '15px' }}>
              <button onClick={() => setActiveSubTab('search')} style={{ flex: 1, padding: '10px', backgroundColor: activeSubTab === 'search' ? '#2c2e33' : 'transparent', border: 'none', color: activeSubTab === 'search' ? '#4dabf7' : '#909296', cursor: 'pointer', fontWeight: 'bold', borderBottom: activeSubTab === 'search' ? '2px solid #228be6' : 'none' }}>
                Căutare Joburi
              </button>
              <button onClick={() => setActiveSubTab('custom')} style={{ flex: 1, padding: '10px', backgroundColor: activeSubTab === 'custom' ? '#2c2e33' : 'transparent', border: 'none', color: activeSubTab === 'custom' ? '#4dabf7' : '#909296', cursor: 'pointer', fontWeight: 'bold', borderBottom: activeSubTab === 'custom' ? '2px solid #228be6' : 'none' }}>
                Link / Descriere
              </button>
            </div>

            {activeSubTab === 'search' ? (
              <div>
                <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontSize: '0.85rem', color: '#909296' }}>Ce cauți (titlu, tehnologie, companie):</label>
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="ex: React developer London" style={input} />
                  <label style={{ fontSize: '0.85rem', color: '#909296' }}>Interval de salariu (opțional):</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="number" min="0" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="min (ex. 40000)" style={{ ...input, flex: 1 }} />
                    <input type="number" min="0" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="max (ex. 70000)" style={{ ...input, flex: 1 }} />
                  </div>
                  <div style={{ display: 'flex', gap: '15px', fontSize: '0.85rem' }}>
                    {(['linkedin', 'indeed', 'cv_library'] as const).map((p) => (
                      <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedPlatforms.includes(p)} onChange={() => togglePlatform(p)} />
                        {p === 'cv_library' ? 'CV Library' : p === 'linkedin' ? 'LinkedIn' : 'Indeed'}
                      </label>
                    ))}
                  </div>
                  <button type="submit" disabled={searching} style={{ backgroundColor: '#228be6', color: '#fff', border: 'none', borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {searching ? 'Se caută...' : 'Caută Joburi'}
                  </button>
                </form>

                {searchNote && <p style={{ fontSize: '0.8rem', color: '#ffd43b', marginTop: '10px' }}>{searchNote}</p>}

                {jobs.length > 0 && (
                  <div style={{ marginTop: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#a5d8ff' }}>Rezultate reale (bifează ce te interesează):</h4>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {jobs.map((job) => (
                        <div key={job.id} style={{ backgroundColor: '#1a1b1e', padding: '10px', borderRadius: '4px', border: selectedJobIds.includes(job.id) ? '1px solid #228be6' : '1px solid #373a40', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                          <input type="checkbox" checked={selectedJobIds.includes(job.id)} onChange={() => toggleJob(job.id)} style={{ marginTop: '4px' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontSize: '0.9rem', color: '#fff' }}>{job.title}</strong>
                              <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '3px', backgroundColor: '#373a40', color: '#fff', whiteSpace: 'nowrap' }}>{job.platform}</span>
                            </div>
                            <p style={{ fontSize: '0.75rem', color: '#c1c2c5', margin: '5px 0 0 0' }}>{job.description}</p>
                            <a href={job.link} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#4dabf7', wordBreak: 'break-all' }}>{job.link}</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '0.85rem', color: '#909296' }}>Link Job:</label>
                <input type="text" value={jobLink} onChange={(e) => setJobLink(e.target.value)} placeholder="https://..." style={input} />
                <label style={{ fontSize: '0.85rem', color: '#909296' }}>Sau descrierea jobului:</label>
                <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Lipește descrierea jobului aici..." style={{ ...input, height: '120px', fontSize: '0.85rem', resize: 'vertical' }} />
              </div>
            )}

            <button onClick={handleAdapt} disabled={adapting} style={{ marginTop: '15px', backgroundColor: '#37b24d', color: '#fff', border: 'none', borderRadius: '4px', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', width: '100%' }}>
              {adapting ? 'Agenții lucrează (cercetare → adaptare → verificare → plan)...' : 'Adaptează CV & Pregătește Aplicarea'}
            </button>
          </div>
        </div>

        <div style={{ ...box, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>Rezultat & Plan de Aplicare</h3>
          {pasi.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {pasi.map((p) => (
                <span key={p.agent + p.nume} style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', backgroundColor: p.ok ? '#37b24d22' : '#f03e3e22', color: p.ok ? '#37b24d' : '#f03e3e', border: `1px solid ${p.ok ? '#37b24d55' : '#f03e3e55'}` }}>
                  {p.ok ? '✓' : '✕'} {p.nume}
                </span>
              ))}
            </div>
          )}
          <textarea readOnly value={rezultatComplet} placeholder="CV-ul adaptat, scrisoarea de intenție, verificarea și planul de interviu apar aici după ce agenții termină..." style={{ width: '100%', flex: 1, minHeight: '450px', backgroundColor: '#1a1b1e', color: '#fff', border: '1px solid #373a40', borderRadius: '4px', padding: '15px', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'none', whiteSpace: 'pre-wrap' }} />
          {rezultatComplet && (
            <button onClick={() => { void navigator.clipboard.writeText(rezultatComplet); setSuccessMessage('Rezultatul a fost copiat.') }} style={{ marginTop: '10px', backgroundColor: '#495057', color: '#fff', border: 'none', borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>
              Copiază Tot Rezultatul
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
