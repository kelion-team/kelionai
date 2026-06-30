// Skill "monitor / workspace" mode store. When a skill needs a large surface,
// it calls openWorkspace(): the avatar shrinks + slides to the top-right corner
// (picture-in-picture) and the background becomes a workspace that can render
// content. closeWorkspace() reverses the animation. A tiny external store so any
// component (Stage avatar, ChatPanel, a skill handler) can drive it.
//
// Subscribe from React with useSyncExternalStore(subscribeWorkspace, getWorkspace).

export interface WorkspaceState {
  readonly open: boolean
  readonly title: string
  readonly url: string // optional content to render (sandboxed iframe)
}

let state: WorkspaceState = { open: false, title: '', url: '' }
const subscribers = new Set<() => void>()

function emit(): void {
  for (const fn of subscribers) fn()
}

export function getWorkspace(): WorkspaceState {
  return state
}

export function subscribeWorkspace(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

export function openWorkspace(title: string, url = ''): void {
  state = { open: true, title, url }
  emit()
}

export function closeWorkspace(): void {
  if (!state.open) return
  state = { ...state, open: false }
  emit()
}

export function toggleWorkspace(title: string, url = ''): void {
  if (state.open) closeWorkspace()
  else openWorkspace(title, url)
}
