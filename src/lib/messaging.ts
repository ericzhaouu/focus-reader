export type Request =
  | { type: 'OPEN_ARTICLE'; bookmarkId: string; url: string }
  | { type: 'MARK_READ'; bookmarkId: string }
  | { type: 'ABANDON'; bookmarkId: string };

export interface ResponseMap {
  OPEN_ARTICLE: { ok: boolean; tabId?: number; error?: string };
  MARK_READ: { ok: boolean; missing?: boolean; error?: string; complete?: boolean };
  ABANDON: { ok: boolean; error?: string; complete?: boolean };
}

export type RequestType = Request['type'];
export type ResponseFor<T extends RequestType> = ResponseMap[T];

/** Fire-and-forget broadcast so open reader tabs can refresh themselves. */
export const BATCH_UPDATED = 'BATCH_UPDATED' as const;
export interface BatchUpdatedEvent {
  type: typeof BATCH_UPDATED;
}

export async function sendMessage<T extends Request>(message: T): Promise<ResponseFor<T['type']>> {
  return (await chrome.runtime.sendMessage(message)) as ResponseFor<T['type']>;
}

export function broadcastBatchUpdated(): void {
  // No receiver is a perfectly normal state (no reader tab open).
  chrome.runtime.sendMessage({ type: BATCH_UPDATED } satisfies BatchUpdatedEvent).catch(() => {});
}

export function onBatchUpdated(listener: () => void): () => void {
  const handler = (message: unknown): void => {
    if ((message as BatchUpdatedEvent | undefined)?.type === BATCH_UPDATED) listener();
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}
