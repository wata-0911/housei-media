import { authorizeCalendarRequest } from '../server/calendar-authorization';
import { decodeDraftPng, MAX_BRIDGE_BYTES, parseDraftMetadata } from '../server/calendar-draft-image';

const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
function failure(code: string, error: string, status = 502): Response {
  return Response.json({ ok: false, code, error }, { status, headers });
}

async function readBridge(response: Response): Promise<unknown> {
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

export default {
  async fetch(request: Request): Promise<Response> {
    // Never rely on the preceding UI/calendar-auth check: verify LINE and membership afresh.
    const authorization = await authorizeCalendarRequest(request);
    if (!authorization.ok) return authorization;

    const bridgeUrl = process.env.GAS_CALENDAR_DRAFT_WEB_APP_URL;
    const secret = process.env.GAS_CALENDAR_DRAFT_SECRET;
    if (!bridgeUrl || !secret) return failure('server_config', '下書き取得サーバーの設定が不足しています', 503);
    let url: URL;
    try {
      url = new URL(bridgeUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password ||
          url.search || url.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error('Invalid URL');
    } catch {
      return failure('server_config', '下書き取得サーバーの設定が不正です', 503);
    }

    const signal = AbortSignal.timeout(15_000);
    try {
      let upstream = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_current_draft', secret }),
        redirect: 'manual', cache: 'no-store', signal,
      });
      // GAS ContentService redirects to its temporary content host. Never forward the secret.
      if ([301, 302, 303].includes(upstream.status)) {
        const location = upstream.headers.get('location');
        if (!location) throw new Error('Missing redirect');
        const target = new URL(location, url);
        if (target.protocol !== 'https:' || target.hostname !== 'script.googleusercontent.com' || target.port || target.username || target.password || target.hash) throw new Error('Invalid redirect');
        await upstream.body?.cancel();
        upstream = await fetch(target, { method: 'GET', redirect: 'error', cache: 'no-store', signal });
      }
      if (!upstream.ok) { await upstream.body?.cancel(); return failure('draft_upstream', '下書き取得先でエラーが発生しました'); }
      const payload = await readBridge(upstream);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid response');
      const draft = payload as Record<string, unknown>;
      if (draft.ok === false) {
        if (draft.error === 'draft_not_ready') return failure('draft_not_ready', '表示できる下書きはまだありません', 404);
        if (draft.error === 'unauthorized') return failure('draft_bridge_auth', '下書き取得先の認証設定を確認してください');
        return failure('draft_upstream', '下書き取得先でエラーが発生しました');
      }
      if (draft.ok !== true || draft.mimeType !== 'image/png') throw new Error('Invalid response');
      const metadata = parseDraftMetadata(draft.yearMonth, draft.generatedAt);
      const png = decodeDraftPng(draft.imageBase64);
      return new Response(new Uint8Array(png), { headers: {
        ...headers, 'Content-Type': 'image/png', 'Content-Length': String(png.length),
        'X-Calendar-Year-Month': metadata.yearMonth, 'X-Calendar-Generated-At': metadata.generatedAt,
      } });
    } catch {
      return signal.aborted
        ? failure('draft_timeout', '下書き取得がタイムアウトしました', 504)
        : failure('draft_invalid_response', '下書き取得先から有効なPNGと日時情報を取得できませんでした');
    }
  },
};
