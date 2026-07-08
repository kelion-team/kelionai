import { useProgress } from '@react-three/drei'

// A VISIBLE loading state for the 3D avatar so its area is NEVER a dead black
// screen while the (large ~9MB) GLB downloads — on a fresh phone over cellular
// that takes many seconds, and a tester who opens the app to a black screen
// concludes it's broken (Adrian, 8 iul). Renders as an HTML overlay next to the
// Canvas (not inside it), shown until three's loading manager reports idle.
export default function AvatarLoading() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="avatar-loading" role="status" aria-live="polite">
      <div className="avatar-loading-spinner" aria-hidden="true" />
      <span className="avatar-loading-label">
        Kelionai{progress > 0 ? ` · ${Math.round(progress)}%` : ''}
      </span>
    </div>
  )
}
