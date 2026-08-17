import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startErrorReporting } from './lib/errorReport'

// Kelion's eyes on F12: browser errors go to the server, and Kelion sees
// them in context and diagnoses for real ("why doesn't X work?").
startErrorReporting()

createRoot(document.getElementById('root')!).render(<App />)
