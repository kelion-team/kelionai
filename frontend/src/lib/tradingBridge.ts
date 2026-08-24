type QueryDocument = Pick<Document, 'querySelector'>

const TRADING_FRAME = 'iframe.workspace-frame[data-kelion-kind="tranzactii"]'

function frame(doc: QueryDocument): HTMLIFrameElement | null {
  return doc.querySelector<HTMLIFrameElement>(TRADING_FRAME)
}

export function trustedTradingMessage(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  expectedOrigin: string,
  doc: QueryDocument = document,
): boolean {
  if (event.origin !== expectedOrigin) return false
  const trading = frame(doc)
  return trading?.contentWindow != null && event.source === trading.contentWindow
}

export function postTradingMessage(
  message: unknown,
  targetOrigin: string,
  doc: QueryDocument = document,
): boolean {
  const target = frame(doc)?.contentWindow
  if (!target) return false
  target.postMessage(message, targetOrigin)
  return true
}
