import { config } from '../config.js'

/** The sole runtime tariff/privilege identity check. Database role labels,
 * voice, face, headers and model output never grant admin authority. */
export function esteAdminKelion(email: string): boolean {
  const key = String(email ?? '').trim().toLowerCase()
  const admin = config.adminEmail.trim().toLowerCase()
  return Boolean(key && admin && key === admin)
}
