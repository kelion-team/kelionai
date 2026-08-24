const CHAT_RETRY_NESIGUR = new Set([
  'turn_result_indeterminate',
  'idempotency_key_conflict',
  'turn_charge_already_exists',
])

/** A fresh execution could duplicate an already-started external action. */
export function retryChatEsteNesigur(errorCode: string): boolean {
  return CHAT_RETRY_NESIGUR.has(errorCode)
}
