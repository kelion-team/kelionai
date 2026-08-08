// Resize the generated logos to 120x120 (Google consent-screen size). Produces
// tiny PNGs (well under the 1MB limit) so any of them can be uploaded.
import Jimp from 'jimp'
import { statSync } from 'node:fs'

const dir = 'C:/Users/adria/Kelionai/docs/logo'
for (let i = 1; i <= 3; i++) {
  const src = `${dir}/kelion-logo-${i}.png`
  const out = `${dir}/kelion-logo-${i}-120.png`
  const img = await Jimp.read(src)
  img.resize(120, 120)
  await img.writeAsync(out)
  console.log(`${i} -> ${out} (${statSync(out).size} bytes)`)
}
