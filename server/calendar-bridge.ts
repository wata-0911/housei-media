import { MAX_BRIDGE_BYTES } from './calendar-draft-image.js';
export async function readBridge(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BRIDGE_BYTES)) throw new Error('Oversize response');
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Not JSON');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BRIDGE_BYTES) throw new Error('Oversize response');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function calendarBridgeUrl(): URL {
  const url = new URL(process.env.GAS_CALENDAR_DRAFT_WEB_APP_URL || '');
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.search || url.hash ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error('Invalid URL');
  return url;
}
export class CalendarBridgeHttpError extends Error {}
export async function callCalendarBridge(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const url = calendarBridgeUrl();
  let upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual', cache: 'no-store', signal });
  if ([301, 302, 303].includes(upstream.status)) {
    const location = upstream.headers.get('location');
    if (!location) throw new Error('Missing redirect');
    const target = new URL(location, url);
    if (target.protocol !== 'https:' || target.hostname !== 'script.googleusercontent.com' || target.port || target.username || target.password || target.hash || target.pathname !== '/macros/echo') throw new Error('Invalid redirect');
    await upstream.body?.cancel();
    upstream = await fetch(target, { method: 'GET', redirect: 'error', cache: 'no-store', signal });
  }
  if (!upstream.ok) { await upstream.body?.cancel(); throw new CalendarBridgeHttpError('Bridge HTTP failure'); }
  return readBridge(upstream);
}
