// ── MEDIA CONTROL via OS-level API (order #16) ─────────────────────────────────
// Queries the native OS media API (playerctl on Linux) to check if anything is
// playing, sends pause if so, and returns a result the brain can confirm verbally.
//
// playerctl is the standard MPRIS client for Linux. It talks to any media player
// that registers on the D-Bus session bus (Spotify, VLC, Firefox/Chromium with
// MPRIS enabled, mpv, etc.).
//
// Risk (as noted in the analysis): some web players or non-standard apps do not
// register their session → false negatives. The tool reports honestly when it
// finds nothing.

import { execSync } from 'node:child_process'

export interface MediaControlResult {
  /** Whether any player was found and was actively playing. */
  wasPlaying: boolean
  /** The player name (e.g. "spotify", "vlc", "firefox") — only when wasPlaying. */
  player?: string
  /** The title of the media that was playing, if available. */
  title?: string
  /** What happened: "stopped", "already_stopped", or "no_player_found". */
  action: 'stopped' | 'already_stopped' | 'no_player_found'
  /** A human-readable message for the brain to confirm verbally. */
  message: string
}

/**
 * Check if playerctl is available on the system.
 */
function hasPlayerctl(): boolean {
  try {
    execSync('which playerctl', { stdio: 'pipe', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * Run playerctl and return the trimmed stdout, or null on failure.
 */
function playerctl(args: string): string | null {
  try {
    const out = execSync(`playerctl ${args}`, { stdio: 'pipe', timeout: 5000, encoding: 'utf-8' })
    return out.trim()
  } catch {
    return null
  }
}

/**
 * Query the OS media API: check playback state, pause if playing, report.
 */
export function mediaControl(): string {
  if (!hasPlayerctl()) {
    const result: MediaControlResult = {
      wasPlaying: false,
      action: 'no_player_found',
      message: 'playerctl nu este instalat pe acest server — nu pot controla media.',
    }
    return JSON.stringify(result)
  }

  // 1. Check if anything is playing right now.
  const status = playerctl('status')
  if (status === null) {
    const result: MediaControlResult = {
      wasPlaying: false,
      action: 'no_player_found',
      message: 'Nu am găsit niciun player media activ — nu rula nimic.',
    }
    return JSON.stringify(result)
  }

  if (status !== 'Playing') {
    // Something has a player open but it's not playing.
    const result: MediaControlResult = {
      wasPlaying: false,
      action: 'already_stopped',
      message: 'Nu rula nimic — playerul media era deja oprit.',
    }
    return JSON.stringify(result)
  }

  // 2. Get the player name and title before pausing.
  const playerName = playerctl('--list-all')?.split('\n')[0]?.split('.')?.pop() ?? 'necunoscut'
  const title = playerctl('metadata title') ?? undefined

  // 3. Pause.
  const paused = playerctl('pause')
  if (paused === null) {
    // Pause command failed — try to report honestly.
    const result: MediaControlResult = {
      wasPlaying: true,
      player: playerName,
      title,
      action: 'already_stopped', // couldn't stop
      message: `Rula ${title ? `"${title}"` : 'ceva'} în ${playerName}, dar nu am reușit să opresc.`,
    }
    return JSON.stringify(result)
  }

  // 4. Success.
  const result: MediaControlResult = {
    wasPlaying: true,
    player: playerName,
    title,
    action: 'stopped',
    message: title
      ? `Am oprit "${title}" din ${playerName}.`
      : `Am oprit redarea din ${playerName}.`,
  }
  return JSON.stringify(result)
}
