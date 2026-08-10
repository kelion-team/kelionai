import React, { useState, useEffect, useRef } from 'react'

// Adaptare CV — fluxul SIMPLU (Adrian, 10 aug): CV de bază + specificația jobului
// (lipită de user, el își caută singur jobul) → adaptare inteligentă (inserează
// cerințele reale ale jobului, cu cap, fără invenție) → previzualizare → download
// „nume_aplicant_nume_job.doc". Fără căutare / platforme / salariu / locație.

interface CvAdaptationProps {
  onClose: () => void
}

export default function CvAdaptation({ onClose }: CvAdaptationProps): React.ReactElement {
  const [cvImplicit, setCvImplicit] = useState('')
  const [applicantName, setApplicantName] = useState('')
  const [jobSpec, setJobSpec] = useState('')

  const [savingCv, setSavingCv] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [adapting, setAdapting] = useState(false)
  const [adaptedCv, setAdaptedCv] = useState('')
  const [jobName, setJobName] = useState('')
  const [fileName, setFileName] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    fetch('/api/jobs/cv-implicit')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load'))))
      .then((data) => { if (data.cv) setCvImplicit(data.cv) })
      .catch(() => setErrorMessage('Nu s-a putut încărca CV-ul salvat.'))
  }, [])

  const handleSaveCv = async (): Promise<void> => {
    setSavingCv(true); setErrorMessage(''); setSuccessMessage('')
    try {
      const res = await fetch('/api/jobs/cv-implicit', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: cvImplicit }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMessage(data.error || 'Eroare la salvare'); return }
      setSuccessMessage('CV-ul de bază a fost salvat.')
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
    setAdaptedCv(''); setJobName(''); setFileName('')
    if (!cvImplicit.trim()) { setErrorMessage('Scrie sau încarcă întâi CV-ul de bază.'); setAdapting(false); return }
    if (!jobSpec.trim()) { setErrorMessage('Lipește specificația (anunțul) jobului.'); setAdapting(false); return }
    try {
      const res = await fetch('/api/jobs/adapt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvContent: cvImplicit, jobSpec, applicantName }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorMessage(data.error || 'Eroare la adaptare'); return }
      setAdaptedCv(data.adaptedCv || '')
      setJobName(data.jobName || '')
      setFileName(data.fileName || 'cv_adaptat')
      setSuccessMessage('Adaptare gata — previzualizează și descarcă.')
    } catch {
      setErrorMessage('A apărut o eroare de rețea la adaptare.')
    } finally {
      setAdapting(false)
    }
  }

  // Download ca .doc (deschide în Word/LibreOffice), numit „nume_aplicant_nume_job".
  const handleDownload = (): void => {
    if (!adaptedCv.trim()) return
    const esc = adaptedCv.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<html><head><meta charset="utf-8"></head><body><pre style="font-family:Calibri,Arial,sans-serif;white-space:pre-wrap;font-size:11pt;line-height:1.4;">${esc}</pre></body></html>`
    const blob = new Blob([html], { type: 'application/msword' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName || 'cv_adaptat'}.doc`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const box: React.CSSProperties = { backgroundColor: '#25262b', padding: '15px', borderRadius: '6px', border: '1px solid #2c2e33' }
  const input: React.CSSProperties = { width: '100%', backgroundColor: '#1a1b1e', color: '#fff', border: '1px solid #373a40', borderRadius: '4px', padding: '8px 12px', fontSize: '0.9rem' }
  const btn = (bg: string): React.CSSProperties => ({ backgroundColor: bg, color: '#fff', border: 'none', borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold', width: '100%' })

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1e1e24', borderRadius: '8px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid #3a3a4a', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #3a3a4a', paddingBottom: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#4dabf7' }}>Adaptare CV</h2>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
      </div>

      {errorMessage && <div style={{ backgroundColor: '#f03e3e22', color: '#f03e3e', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #f03e3e55' }}>{errorMessage}</div>}
      {successMessage && <div style={{ backgroundColor: '#37b24d22', color: '#37b24d', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #37b24d55' }}>{successMessage}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={box}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>1. CV-ul tău de bază</h3>
            <p style={{ fontSize: '0.85rem', color: '#909296', margin: '0 0 10px 0' }}>
              Scrie-l aici sau încarcă un fișier (text, PDF sau poză). Se salvează și rămâne pentru data viitoare.
            </p>
            <input ref={fileRef} type="file" accept=".txt,.md,.csv,.pdf,image/*,application/pdf" onChange={handleUpload} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...btn('#495057'), marginBottom: '10px' }}>
              {uploading ? 'Se citește fișierul...' : '📎 Încarcă CV (text / PDF / poză)'}
            </button>
            <textarea value={cvImplicit} onChange={(e) => setCvImplicit(e.target.value)} style={{ ...input, height: '220px', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical' }} placeholder="Scrie sau încarcă CV-ul tău de bază aici..." />
            <button onClick={handleSaveCv} disabled={savingCv} style={{ ...btn('#228be6'), marginTop: '10px' }}>
              {savingCv ? 'Se salvează...' : 'Salvează CV-ul de bază'}
            </button>
          </div>

          <div style={box}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>2. Jobul (îl cauți tu)</h3>
            <label style={{ fontSize: '0.85rem', color: '#909296' }}>Numele tău (pentru fișier):</label>
            <input type="text" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="ex: Adrian Popescu" style={{ ...input, marginBottom: '10px' }} />
            <label style={{ fontSize: '0.85rem', color: '#909296' }}>Specificația jobului (lipește tot anunțul):</label>
            <textarea value={jobSpec} onChange={(e) => setJobSpec(e.target.value)} style={{ ...input, height: '180px', fontSize: '0.85rem', resize: 'vertical', marginTop: '4px' }} placeholder="Lipește aici titlul + toată descrierea/cerințele jobului găsit de tine..." />
            <button onClick={handleAdapt} disabled={adapting} style={{ ...btn('#37b24d'), marginTop: '12px', padding: '10px 20px', fontSize: '1rem' }}>
              {adapting ? 'Se adaptează CV-ul...' : 'Adaptează & Previzualizează'}
            </button>
          </div>
        </div>

        <div style={{ ...box, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>
            3. CV adaptat{jobName ? ` — ${jobName}` : ''}
          </h3>
          <textarea readOnly value={adaptedCv} placeholder="CV-ul adaptat pe cerințele jobului apare aici. Îl previzualizezi, apoi îl descarci." style={{ width: '100%', flex: 1, minHeight: '470px', backgroundColor: '#1a1b1e', color: '#fff', border: '1px solid #373a40', borderRadius: '4px', padding: '15px', fontFamily: 'monospace', fontSize: '0.85rem', resize: 'none', whiteSpace: 'pre-wrap' }} />
          {adaptedCv && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button onClick={handleDownload} style={{ ...btn('#37b24d'), flex: 2 }}>
                ⬇ Descarcă ({fileName || 'cv_adaptat'}.doc)
              </button>
              <button onClick={() => { void navigator.clipboard.writeText(adaptedCv); setSuccessMessage('CV-ul adaptat a fost copiat.') }} style={{ ...btn('#495057'), flex: 1 }}>
                Copiază
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
