import { config } from '../config.js'
import type { ExpenseLine } from '../shared/api-types.js'

/** Furnizori de cost cunoscuți aplicației. Nu acceptă și nu gestionează carduri. */
export async function cheltuieliAplicatiei(): Promise<ExpenseLine[]> {
  return [
    {
      name: 'OpenAI',
      what: 'Responses, Realtime și media AI online',
      configured: Boolean(config.openai.key),
      billing: 'cheltuială internă Kelion, măsurată separat de portofelul userului',
      billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    },
    {
      name: 'Serper',
      what: 'căutare web',
      configured: Boolean(config.serperKey),
      billing: 'cont furnizor separat',
      billingUrl: 'https://serper.dev/',
    },
  ]
}
