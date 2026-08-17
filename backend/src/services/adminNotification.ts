import { getPool, dbEnabled } from '../db.js'

export type AdminNotificationType =
  | 'scris'
  | 'voce'
  | 'plata_neatribuita'
  | 'pr_gata'
  // Santinela publicării (15 aug: „monitorizat de Kelion"): stagnarea și revenirea.
  | 'publicare_blocata'
  | 'publicare_ok'
  // Bucla închisă a cerințelor (P4; owner, 15 aug): verdictul probei pe live
  // ajunge LA OM (panou + push pe telefon), nu doar în coloana de stare.
  | 'cerinta_live'
  | 'cerinta_picata'

export interface AdminNotification {
  id?: number
  type: AdminNotificationType
  title: string
  message: string
  payload?: any
  createdAt?: string
  read?: boolean
}

export async function notifyAdmin(
  type: AdminNotificationType,
  title: string,
  message: string,
  payload?: Record<string, any>
): Promise<number> {
  if (!dbEnabled()) return 0
  const pool = getPool()
  const payloadJson = payload ? JSON.stringify(payload) : null

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload JSONB,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  const res = await pool.query(
    `INSERT INTO admin_notifications (type, title, message, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
    [type, title, message, payloadJson]
  )

  // Aceeași notificare zboară și pe telefonul ownerului (Web Push) — fără să
  // țină pe loc apelantul și fără să-i poată strica vreodată tura: un push
  // picat rămâne doar picat, rândul din panou există deja.
  void import('./pushTelefon.js')
    .then(({ trimitePushAdmin }) => trimitePushAdmin(title, message, { tip: type, ...(payload ?? {}) }))
    .catch(() => 0)

  return res.rows[0]?.id || 0
}

export async function getAdminNotifications(
  limit = 50,
  unreadOnly = false
): Promise<AdminNotification[]> {
  if (!dbEnabled()) return []
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload JSONB,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  let query = `SELECT id, type, title, message, payload, read, created_at as "createdAt" FROM admin_notifications`
  if (unreadOnly) {
    query += ` WHERE read = FALSE`
  }
  query += ` ORDER BY created_at DESC LIMIT $1`

  try {
    const res = await pool.query(query, [limit])
    return res.rows
  } catch {
    return []
  }
}

export async function markAdminNotificationRead(id: number): Promise<boolean> {
  if (!dbEnabled()) return false
  const pool = getPool()
  try {
    const res = await pool.query(`UPDATE admin_notifications SET read = TRUE WHERE id = $1`, [id])
    return (res.rowCount ?? 0) > 0
  } catch {
    return false
  }
}
