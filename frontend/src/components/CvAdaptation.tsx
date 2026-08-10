import React, { useState, useEffect } from 'react'

interface Job {
  id: string
  platform: string
  title: string
  company: string
  location: string
  description: string
  link: string
}

interface CvAdaptationProps {
  onClose: () => void
}

export default function CvAdaptation({ onClose }: CvAdaptationProps) {
  // Tabs: 'search' or 'custom'
  const [activeSubTab, setActiveSubTab] = useState<'search' | 'custom'>('search')

  // Search state
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['linkedin', 'indeed', 'cv_library'])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [searching, setSearching] = useState(false)

  // Custom Job state
  const [jobLink, setJobLink] = useState('')
  const [jobDescription, setJobDescription] = useState('')

  // CV implicit state
  const [cvImplicit, setCvImplicit] = useState('')
  const [savingCv, setSavingCv] = useState(false)

  // Adaptation result state
  const [adapting, setAdapting] = useState(false)
  const [adaptedCv, setAdaptedCv] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Load CV implicit on mount
  useEffect(() => {
    fetch('/api/jobs/cv-implicit')
      .then(res => {
        if (!res.ok) throw new Error('Eroare la încărcarea CV-ului')
        return res.json()
      })
      .then(data => {
        if (data.cv) setCvImplicit(data.cv)
      })
      .catch(err => {
        console.error(err)
        setErrorMessage('Nu s-a putut încărca CV-ul implicit.')
      })
  }, [])

  // Handle platform checkbox toggle
  const togglePlatform = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform))
    } else {
      setSelectedPlatforms([...selectedPlatforms, platform])
    }
  }

  // Handle job checkbox toggle
  const toggleJobSelection = (jobId: string) => {
    if (selectedJobIds.includes(jobId)) {
      setSelectedJobIds(selectedJobIds.filter(id => id !== jobId))
    } else {
      setSelectedJobIds([...selectedJobIds, jobId])
    }
  }

  // Search jobs
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setSearching(true)
    setErrorMessage('')
    try {
      const res = await fetch('/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchTerm, platforms: selectedPlatforms })
      })
      if (!res.ok) throw new Error('Eroare la căutare')
      const data = await res.json()
      setJobs(data.jobs || [])
      setSelectedJobIds([]) // Clear previous selection
    } catch (err) {
      console.error(err)
      setErrorMessage('A apărut o eroare la căutarea joburilor.')
    } finally {
      setSearching(false)
    }
  }

  // Save CV implicit
  const handleSaveCv = async () => {
    setSavingCv(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const res = await fetch('/api/jobs/cv-implicit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: cvImplicit })
      })
      if (!res.ok) throw new Error('Eroare la salvare')
      setSuccessMessage('CV-ul implicit a fost salvat cu succes!')
    } catch (err) {
      console.error(err)
      setErrorMessage('Nu s-a putut salva CV-ul implicit.')
    } finally {
      setSavingCv(false)
    }
  }

  // Adapt CV
  const handleAdaptCv = async () => {
    setAdapting(true)
    setErrorMessage('')
    setSuccessMessage('')
    setAdaptedCv('')

    const body: any = {
      cvContent: cvImplicit
    }

    if (activeSubTab === 'search') {
      if (selectedJobIds.length === 0) {
        setErrorMessage('Vă rugăm să selectați cel puțin un job din lista de rezultate.')
        setAdapting(false)
        return
      }
      body.jobIds = selectedJobIds
    } else {
      if (!jobDescription && !jobLink) {
        setErrorMessage('Vă rugăm să introduceți o descriere sau un link pentru job.')
        setAdapting(false)
        return
      }
      body.jobDescription = jobDescription
      body.jobLink = jobLink
    }

    try {
      const res = await fetch('/api/jobs/adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error('Eroare la adaptare')
      const data = await res.json()
      setAdaptedCv(data.adaptedCv || '')
      setSuccessMessage(data.message || 'CV-ul a fost adaptat cu succes!')
    } catch (err) {
      console.error(err)
      setErrorMessage('A apărut o eroare la adaptarea CV-ului.')
    } finally {
      setAdapting(false)
    }
  }

  return (
    <div className="cv-adaptation-container" style={{
      padding: '20px',
      color: '#fff',
      backgroundColor: '#1e1e24',
      borderRadius: '8px',
      maxHeight: '90vh',
      overflowY: 'auto',
      border: '1px solid #3a3a4a',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #3a3a4a', paddingBottom: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#4dabf7' }}>Adaptare CV Inteligentă</h2>
        <button onClick={onClose} style={{
          background: 'transparent',
          border: 'none',
          color: '#aaa',
          fontSize: '1.5rem',
          cursor: 'pointer'
        }}>&times;</button>
      </div>

      {errorMessage && (
        <div style={{ backgroundColor: '#f03e3e22', color: '#f03e3e', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #f03e3e55' }}>
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div style={{ backgroundColor: '#37b24d22', color: '#37b24d', padding: '10px', borderRadius: '4px', marginBottom: '15px', border: '1px solid #37b24d55' }}>
          {successMessage}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Left column: CV Implicit management */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={{ backgroundColor: '#25262b', padding: '15px', borderRadius: '6px', border: '1px solid #2c2e33' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>CV-ul Tău Implicit (Sursă)</h3>
            <p style={{ fontSize: '0.85rem', color: '#909296', margin: '0 0 10px 0' }}>
              Acesta este CV-ul de bază care va fi adaptat automat în funcție de cerințele joburilor selectate.
            </p>
            <textarea
              value={cvImplicit}
              onChange={(e) => setCvImplicit(e.target.value)}
              style={{
                width: '100%',
                height: '250px',
                backgroundColor: '#1a1b1e',
                color: '#fff',
                border: '1px solid #373a40',
                borderRadius: '4px',
                padding: '10px',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                resize: 'vertical'
              }}
              placeholder="Introduceți textul CV-ului dumneavoastră aici..."
            />
            <button
              onClick={handleSaveCv}
              disabled={savingCv}
              style={{
                marginTop: '10px',
                backgroundColor: '#228be6',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                cursor: 'pointer',
                fontWeight: 'bold',
                width: '100%'
              }}
            >
              {savingCv ? 'Se salvează...' : 'Salvează CV-ul Implicit'}
            </button>
          </div>

          {/* Option selection: Search or Custom */}
          <div style={{ backgroundColor: '#25262b', padding: '15px', borderRadius: '6px', border: '1px solid #2c2e33' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #373a40', marginBottom: '15px' }}>
              <button
                onClick={() => setActiveSubTab('search')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: activeSubTab === 'search' ? '#2c2e33' : 'transparent',
                  border: 'none',
                  color: activeSubTab === 'search' ? '#4dabf7' : '#909296',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  borderBottom: activeSubTab === 'search' ? '2px solid #228be6' : 'none'
                }}
              >
                Căutare Joburi (LinkedIn, Indeed, CV Library)
              </button>
              <button
                onClick={() => setActiveSubTab('custom')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: activeSubTab === 'custom' ? '#2c2e33' : 'transparent',
                  border: 'none',
                  color: activeSubTab === 'custom' ? '#4dabf7' : '#909296',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  borderBottom: activeSubTab === 'custom' ? '2px solid #228be6' : 'none'
                }}
              >
                Adaptare prin Link/Descriere
              </button>
            </div>

            {activeSubTab === 'search' ? (
              <div>
                <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#909296', marginBottom: '5px' }}>
                      Căutare după cuvânt cheie, titlu sau companie:
                    </label>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="ex: React, Full Stack, DevOps..."
                      style={{
                        width: '100%',
                        backgroundColor: '#1a1b1e',
                        color: '#fff',
                        border: '1px solid #373a40',
                        borderRadius: '4px',
                        padding: '8px 12px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#909296', marginBottom: '5px' }}>
                      Platforme de căutare:
                    </label>
                    <div style={{ display: 'flex', gap: '15px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes('linkedin')}
                          onChange={() => togglePlatform('linkedin')}
                        />
                        LinkedIn
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes('indeed')}
                          onChange={() => togglePlatform('indeed')}
                        />
                        Indeed
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes('cv_library')}
                          onChange={() => togglePlatform('cv_library')}
                        />
                        CV Library
                      </label>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={searching}
                    style={{
                      backgroundColor: '#228be6',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    {searching ? 'Se caută...' : 'Caută Joburi'}
                  </button>
                </form>

                {jobs.length > 0 && (
                  <div style={{ marginTop: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#a5d8ff' }}>Rezultate căutare (Selectați multiple pentru adaptare):</h4>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {jobs.map(job => (
                        <div key={job.id} style={{
                          backgroundColor: '#1a1b1e',
                          padding: '10px',
                          borderRadius: '4px',
                          border: selectedJobIds.includes(job.id) ? '1px solid #228be6' : '1px solid #373a40',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px'
                        }}>
                          <input
                            type="checkbox"
                            checked={selectedJobIds.includes(job.id)}
                            onChange={() => toggleJobSelection(job.id)}
                            style={{ marginTop: '4px' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong style={{ fontSize: '0.9rem', color: '#fff' }}>{job.title}</strong>
                              <span style={{
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                backgroundColor: job.platform === 'LinkedIn' ? '#0a66c2' : job.platform === 'Indeed' ? '#2164f3' : '#e01a22',
                                color: '#fff'
                              }}>{job.platform}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#909296' }}>{job.company} - {job.location}</div>
                            <p style={{ fontSize: '0.75rem', color: '#c1c2c5', margin: '5px 0 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {job.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#909296', marginBottom: '5px' }}>
                    Link Job:
                  </label>
                  <input
                    type="text"
                    value={jobLink}
                    onChange={(e) => setJobLink(e.target.value)}
                    placeholder="https://www.linkedin.com/jobs/view/..."
                    style={{
                      width: '100%',
                      backgroundColor: '#1a1b1e',
                      color: '#fff',
                      border: '1px solid #373a40',
                      borderRadius: '4px',
                      padding: '8px 12px',
                      fontSize: '0.9rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#909296', marginBottom: '5px' }}>
                    Descriere Job:
                  </label>
                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Lipiți descrierea completă a jobului aici..."
                    style={{
                      width: '100%',
                      height: '120px',
                      backgroundColor: '#1a1b1e',
                      color: '#fff',
                      border: '1px solid #373a40',
                      borderRadius: '4px',
                      padding: '10px',
                      fontSize: '0.85rem',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleAdaptCv}
              disabled={adapting}
              style={{
                marginTop: '15px',
                backgroundColor: '#37b24d',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '1rem',
                width: '100%'
              }}
            >
              {adapting ? 'Se adaptează automat...' : 'Adaptează CV Automată & Pregătește Aplicarea'}
            </button>
          </div>
        </div>

        {/* Right column: Adaptation Results & Application prep */}
        <div style={{ backgroundColor: '#25262b', padding: '15px', borderRadius: '6px', border: '1px solid #2c2e33', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: '#a5d8ff' }}>Rezultat Adaptare & Plan de Aplicare</h3>
          <p style={{ fontSize: '0.85rem', color: '#909296', margin: '0 0 15px 0' }}>
            Aici va apărea CV-ul adaptat optimizat, scrisoarea de intenție și setul de întrebări posibile pentru interviu.
          </p>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <textarea
              readOnly
              value={adaptedCv}
              placeholder="Rezultatul adaptării inteligente va fi afișat aici după finalizarea procesului..."
              style={{
                width: '100%',
                flex: 1,
                minHeight: '450px',
                backgroundColor: '#1a1b1e',
                color: '#fff',
                border: '1px solid #373a40',
                borderRadius: '4px',
                padding: '15px',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                resize: 'none'
              }}
            />

            {adaptedCv && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(adaptedCv)
                  alert('CV-ul adaptat și planul de aplicare au fost copiate în clipboard!')
                }}
                style={{
                  marginTop: '10px',
                  backgroundColor: '#495057',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Copiază Tot Rezultatul (CV + Pregătire)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
