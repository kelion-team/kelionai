import { loadKv } from './dist/db.js'
const keys = ['video_ultima_incercare', 'video_platit']
for (const k of keys) {
  try {
    const v = await loadKv(k)
    console.log(`${k}: ${v}`)
  } catch (e) {
    console.log(`${k}: ERROR ${e.message}`)
  }
}
