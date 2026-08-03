import { useWindowSize } from '../lib/hooks'

type Props = {
  // URL or base64
  image: string

  // The "monitor" area in the image, in pixels, from top-left.
  monitor: {
    x: number
    y: number
    width: number
    height: number
  }
}

// Renders the image as a dynamic background, scaled and positioned so that
// the "monitor" area of the image fits the real monitor exactly.
export default function DynamicBackground({ image, monitor }: Props) {
  const [width, height] = useWindowSize()

  if (!width || !height || !image) {
    return null
  }

  // Calculate the scale factor
  const scaleX = width / monitor.width
  const scaleY = height / monitor.height
  const scale = Math.max(scaleX, scaleY) // Use 'max' to cover the whole screen without distortion

  // Calculate the scaled dimensions of the image
  const scaledImageWidth = (image ? monitor.width * scale : 0)
  const scaledImageHeight = (image ? monitor.height * scale : 0)

  // Calculate the top-left position of the image
  const x = (width - scaledImageWidth) / 2 - (monitor.x * scale)
  const y = (height - scaledImageHeight) / 2 - (monitor.y * scale)


  const style = {
    backgroundImage: `url(${image})`,
    backgroundSize: `${scaledImageWidth}px ${scaledImageHeight}px`,
    backgroundPosition: `${x}px ${y}px`,
  }

  return <div className="dynamic-bg" style={style} />
}
