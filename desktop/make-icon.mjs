// Compose the 1024×1024 app-icon source: the vector "K bolt" from the web app,
// centered on the app's dark rounded-square background. `tauri icon` then
// derives every platform size (ico, png set) from this one file.
import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'node:fs'

const SIZE = 1024
const bolt = readFileSync(new URL('../frontend/public/favicon.svg', import.meta.url))

const background = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <radialGradient id="g" cx="50%" cy="38%" r="75%">
         <stop offset="0%" stop-color="#1b1230"/>
         <stop offset="100%" stop-color="#0b0a14"/>
       </radialGradient>
     </defs>
     <rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 0.22}" fill="url(#g)"/>
   </svg>`,
)

const boltPng = await sharp(bolt, { density: 300 })
  .resize(Math.round(SIZE * 0.62), Math.round(SIZE * 0.62), {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer()

mkdirSync(new URL('./src-tauri/icons', import.meta.url), { recursive: true })
await sharp(background)
  .composite([{ input: boltPng, gravity: 'centre' }])
  .png()
  .toFile(new URL('./src-tauri/icons/source.png', import.meta.url).pathname.slice(1))
console.log('icon source written: src-tauri/icons/source.png')
