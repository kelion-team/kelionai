// Preview each logo on a black background: make the near-white background
// transparent, then composite on black. Shows how the mark reads on dark.
import Jimp from 'jimp'
const dir = 'C:/Users/adria/Kelionai/docs/logo'
for (let i = 1; i <= 3; i++) {
  const logo = await Jimp.read(`${dir}/kelion-logo-${i}-120.png`)
  logo.scan(0, 0, logo.bitmap.width, logo.bitmap.height, (x, y, idx) => {
    const r = logo.bitmap.data[idx]
    const g = logo.bitmap.data[idx + 1]
    const b = logo.bitmap.data[idx + 2]
    if (r > 235 && g > 235 && b > 235) logo.bitmap.data[idx + 3] = 0 // near-white → transparent
  })
  // save transparent version too (useful for dark UIs)
  await logo.writeAsync(`${dir}/kelion-logo-${i}-transparent.png`)
  const canvas = new Jimp(120, 120, 0x000000ff)
  canvas.composite(logo, 0, 0)
  await canvas.writeAsync(`${dir}/kelion-logo-${i}-on-black.png`)
  console.log(`${i} done`)
}
