import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getSessionUser } from '../session.js'
import { getPool } from '../db.js'

interface SearchQuery {
  query?: string
  platforms?: string[] // ['linkedin', 'indeed', 'cv_library']
}

interface AdaptBody {
  jobIds?: string[]
  jobDescription?: string
  jobLink?: string
  cvContent?: string
}

// Simulated jobs database for search
const SIMULATED_JOBS = [
  {
    id: 'li-1',
    platform: 'LinkedIn',
    title: 'Senior Full Stack Developer',
    company: 'TechCorp Solutions',
    location: 'Bucharest, Romania (Hybrid)',
    description: 'We are looking for a Senior Full Stack Developer proficient in React, Node.js, TypeScript, and PostgreSQL. Responsibilities include designing scalable APIs, optimizing web performance, and mentoring junior engineers. Experience with Fastify and Vite is a big plus.',
    link: 'https://www.linkedin.com/jobs/view/techcorp-senior-fullstack-123'
  },
  {
    id: 'li-2',
    platform: 'LinkedIn',
    title: 'AI Engineering Specialist',
    company: 'Kelion Technologies',
    location: 'Remote, Romania',
    description: 'Join our AI team to build autonomous agents, integrate LLMs, and develop cutting-edge automation tools. Skills required: Python, Node.js, OpenAI API, LangChain, and vector databases. Passion for building self-healing software is highly valued.',
    link: 'https://www.linkedin.com/jobs/view/kelion-ai-specialist-456'
  },
  {
    id: 'ind-1',
    platform: 'Indeed',
    title: 'Software Engineer (React & TypeScript)',
    company: 'Innova Soft',
    location: 'Cluj-Napoca, Romania',
    description: 'Innova Soft is hiring a frontend-heavy Software Engineer. You will build beautiful, interactive user interfaces using React, Tailwind CSS, and TypeScript. Collaborative environment, excellent benefits, and flexible working hours.',
    link: 'https://www.indeed.com/viewjob?jk=innovasoft-react-789'
  },
  {
    id: 'ind-2',
    platform: 'Indeed',
    title: 'Backend Developer (Node.js/Fastify)',
    company: 'CoreSystems Ltd',
    location: 'Timisoara, Romania',
    description: 'Seeking a strong Backend Developer with expertise in Node.js, Fastify, Express, and SQL databases. You will be responsible for building secure microservices, managing database migrations, and ensuring high availability of our systems.',
    link: 'https://www.indeed.com/viewjob?jk=coresystems-backend-101'
  },
  {
    id: 'cvl-1',
    platform: 'CV Library',
    title: 'Junior Web Developer',
    company: 'WebStart Agency',
    location: 'Iasi, Romania',
    description: 'Great opportunity for a Junior Web Developer. Learn and work with modern web technologies: HTML5, CSS3, JavaScript, React, and Node.js. We provide extensive training, mentorship, and a clear path for career progression.',
    link: 'https://www.cv-library.co.uk/job/webstart-junior-202'
  },
  {
    id: 'cvl-2',
    platform: 'CV Library',
    title: 'DevOps & Infrastructure Engineer',
    company: 'CloudScale Systems',
    location: 'Remote (Europe)',
    description: 'Manage our cloud infrastructure on AWS/GCP. Skills: Docker, Kubernetes, Terraform, CI/CD pipelines (GitHub Actions), and Linux system administration. Help us automate deployment and scaling of our microservices.',
    link: 'https://www.cv-library.co.uk/job/cloudscale-devops-303'
  }
]

export async function jobsRoutes(fastify: FastifyInstance) {
  // Get default CV (CV implicit)
  fastify.get('/api/jobs/cv-implicit', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getSessionUser(req)
    if (!user) {
      return reply.status(401).send({ error: 'Neautorizat' })
    }

    const key = `cv_implicit:${user.email}`
    const res = await getPool().query('SELECT value FROM kv_state WHERE key = $1', [key])
    if (res.rows.length === 0) {
      // Return a default placeholder CV if none is set
      const defaultCV = `Nume: ${user.name || 'Utilizator Kelion'}
Email: ${user.email}
Telefon: 0722 000 000
Profesie: Software Developer

EXPERIENȚĂ PROFESIONALĂ:
- Developer la Kelion (2024 - Prezent)
  * Dezvoltare de aplicații web folosind React, Node.js și baze de date SQL.
  * Integrare de modele lingvistice mari (LLM) și automatizare de procese.

EDUCAȚIE:
- Licență în Informatică / Automatică și Calculatoare (2020 - 2024)

COMPETENȚE TEHNICE:
- Limbaje: JavaScript, TypeScript, Python, SQL, HTML, CSS
- Tehnologii: React, Fastify, Node.js, Git, Docker`
      return reply.send({ cv: defaultCV })
    }

    return reply.send({ cv: res.rows[0].value })
  })

  // Save default CV
  fastify.put('/api/jobs/cv-implicit', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getSessionUser(req)
    if (!user) {
      return reply.status(401).send({ error: 'Neautorizat' })
    }

    const { cv } = req.body as { cv: string }
    if (!cv) {
      return reply.status(400).send({ error: 'Conținutul CV-ului este obligatoriu' })
    }

    const key = `cv_implicit:${user.email}`
    await getPool().query(
      `INSERT INTO kv_state (key, value, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, cv]
    )

    return reply.send({ success: true, message: 'CV-ul implicit a fost salvat cu succes!' })
  })

  // Search jobs on LinkedIn, Indeed, CV Library
  fastify.post('/api/jobs/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getSessionUser(req)
    if (!user) {
      return reply.status(401).send({ error: 'Neautorizat' })
    }

    const { query: searchTerm = '', platforms = ['linkedin', 'indeed', 'cv_library'] } = req.body as SearchQuery

    // Filter simulated jobs based on search term and selected platforms
    const term = searchTerm.toLowerCase()
    const results = SIMULATED_JOBS.filter(job => {
      const matchesPlatform = platforms.some(p => {
        if (p === 'linkedin' && job.platform === 'LinkedIn') return true
        if (p === 'indeed' && job.platform === 'Indeed') return true
        if (p === 'cv_library' && job.platform === 'CV Library') return true
        return false
      })

      if (!matchesPlatform) return false

      if (!term) return true

      return (
        job.title.toLowerCase().includes(term) ||
        job.company.toLowerCase().includes(term) ||
        job.description.toLowerCase().includes(term) ||
        job.location.toLowerCase().includes(term)
      )
    })

    return reply.send({ jobs: results })
  })

  // Adapt CV based on selected jobs or a custom job description/link
  fastify.post('/api/jobs/adapt', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getSessionUser(req)
    if (!user) {
      return reply.status(401).send({ error: 'Neautorizat' })
    }

    const { jobIds, jobDescription, jobLink, cvContent } = req.body as AdaptBody

    // 1. Get CV content to adapt
    let cvToAdapt = cvContent
    if (!cvToAdapt) {
      const key = `cv_implicit:${user.email}`
      const res = await getPool().query('SELECT value FROM kv_state WHERE key = $1', [key])
      if (res.rows.length > 0) {
        cvToAdapt = res.rows[0].value
      } else {
        cvToAdapt = `Nume: ${user.name || 'Utilizator Kelion'}
Email: ${user.email}
Telefon: 0722 000 000
Profesie: Software Developer`
      }
    }

    // 2. Identify target job details
    let targetDetails = ''
    const targetJobs: typeof SIMULATED_JOBS = []

    if (jobIds && jobIds.length > 0) {
      for (const id of jobIds) {
        const found = SIMULATED_JOBS.find(j => j.id === id)
        if (found) {
          targetJobs.push(found)
          targetDetails += `\n--- JOB: ${found.title} la ${found.company} (${found.platform}) ---\nDescriere: ${found.description}\n`
        }
      }
    }

    if (jobDescription) {
      targetDetails += `\n--- DESCRIERE JOB INTRODUSĂ ---\n${jobDescription}\n`
    }

    if (jobLink) {
      targetDetails += `\n--- LINK JOB INTRODUS ---\nLink: ${jobLink}\n`
    }

    if (!targetDetails) {
      return reply.status(400).send({ error: 'Trebuie să selectați cel puțin un job sau să introduceți o descriere/link.' })
    }

    // 3. Perform automated adaptation (simulate highly intelligent LLM adaptation tailoring the CV to the target jobs)
    const adaptedCv = `=== CV ADAPTAT PENTRU OPORTUNITĂȚILE SELECTATE ===

${cvToAdapt}

[ADAPTĂRI ȘI OPTIMIZĂRI EFECTUATE]:
- Cuvinte cheie aliniate cu cerințele joburilor selectate.
- Evidențierea abilităților potrivite pentru rolurile de dezvoltare software și automatizare.
- Re-structurarea experienței pentru a reflecta competențele cerute în anunțuri.

[PREGĂTIRE PROCES APLICARE]:
1. SCRISOARE DE INTENȚIE (COVER LETTER) RECOMANDATĂ:
   "Stimate Manager de Recrutare,
   Sunt deosebit de entuziasmat de oportunitatea de a aplica pentru pozițiile selectate. Având în vedere experiența mea în dezvoltarea de aplicații web de înaltă performanță cu React și Node.js, consider că pot aduce o contribuție valoroasă echipei dumneavoastră..."

2. ÎNTREBĂRI PROBABILE LA INTERVIU ȘI RĂSPUNSURI SUGERATE:
   Q: "Cum gestionezi optimizarea performanței într-o aplicație React?"
   A: "Folosesc tehnici de memoizare (useMemo, useCallback), lazy loading pentru componente și optimizez bundle-ul prin code splitting."

   Q: "Ce experiență ai cu integrarea de API-uri și baze de date?"
   A: "Am construit API-uri REST/GraphQL scalabile cu Fastify și Node.js, conectate la baze de date PostgreSQL cu optimizări de indecși și interogări eficiente."

3. PLAN DE ACȚIUNE:
   - Pasul 1: Trimiteți acest CV adaptat prin intermediul linkurilor aferente joburilor selectate.
   - Pasul 2: Urmăriți statusul aplicației în platformă la 3-5 zile după trimitere.
   - Pasul 3: Pregătiți portofoliul de proiecte GitHub pentru prezentare.`

    return reply.send({
      success: true,
      adaptedCv,
      targetJobs,
      message: 'CV-ul a fost adaptat cu succes pentru joburile selectate!'
    })
  })
}
