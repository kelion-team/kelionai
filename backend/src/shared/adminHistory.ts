export interface AdminHistoryCursor { createdAt:string; id:string }
export interface AdminHistoryEntry { id:string; role:string; content:string; created_at:string }
export interface AdminHistoryPage {
  history:AdminHistoryEntry[]
  nextCursor:AdminHistoryCursor | null
  limit:number
  maxLimit:number
}
export interface AdminHistoryQuery { email:string; limit:number; before:AdminHistoryCursor | null }
