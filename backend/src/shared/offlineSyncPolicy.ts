/**
 * Contract comun browser/server pentru conversațiile păstrate offline.
 * Valorile pot fi înăsprite de server prin mediu, dar clientul nu va produce
 * implicit loturi sau mesaje pe care configurația standard le-ar respinge.
 */
export const OFFLINE_SYNC_DEFAULT_MAX_TURNS = 100
export const OFFLINE_SYNC_DEFAULT_MAX_TEXT_CHARS = 8_000
export const OFFLINE_LOCAL_HISTORY_LIMIT = 120
export const OFFLINE_LOCAL_DEFERRED_LIMIT = 100
export const OFFLINE_LOCAL_REJECTED_LIMIT = 100
