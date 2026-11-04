import { createHash } from 'node:crypto';
import { verifyCalendarRequest } from '../server/calendar-authorization.js';
import { decodeDraftPng, parseDraftMetadata } from '../server/calendar-draft-image.js';
import { calendarBridgeUrl, callCalendarBridge, CalendarBridgeHttpError } from '../server/calendar-bridge.js';
import { parseTarget, previewReceipt } from '../server/calendar-approval.js';
import { calendarDeploymentAllowed, calendarUnavailable } from '../server/calendar-deployment.js';
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
function failure(code: string, error: string, status = 502): Response { return Response.json({ ok: false, code, error }, { status, headers }); }
export default {
  async fetch(request: Request): Promise<Response> {
    if (!calendarDeploymentAllowed()) return calendarUnavailable();
    const authorization = await verifyCalendarRequest(request);
    if (authorization instanceof Response) return authorization;
    const secret = process.env.GAS_CALENDAR_DRAFT_SECRET;
    try { calendarBridgeUrl(); if (!secret) throw new Error(); } catch { return failure('server_config', '下書き取得サーバーの設定が不足または不正です', 503); }
    const signal = AbortSignal.timeout(15_000);
    try {
      const payload = await callCalendarBridge({ action: 'get_current_draft', secret, includeApprovalBinding: true }, signal);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
      const draft = payload as Record<string, unknown>;
      if (draft.ok === false) {
        if (draft.error === 'draft_not_ready') return failure('draft_not_ready', '表示できる下書きはまだありません', 404);
        if (draft.error === 'unauthorized') return failure('draft_bridge_auth', '下書き取得先の認証設定を確認してください');
        return failure('draft_upstream', '下書き取得先でエラーが発生しました');
      }
      if (draft.ok !== true || draft.mimeType !== 'image/png') throw new Error();
      const metadata = parseDraftMetadata(draft.yearMonth, draft.generatedAt), png = decodeDraftPng(draft.imageBase64);
      const binding: Record<string, string> = {};
      if (draft.schemaVersion === 2) {
        const target = parseTarget(draft);
        if (createHash('sha256').update(png).digest('hex') !== target.imageSha256 || !['draft_ready', 'approved'].includes(String(draft.status))) throw new Error();
        // Configuration missing: readable but cannot authorize approval.
        try {
          binding['X-Calendar-Preview-Receipt'] = previewReceipt(target, authorization.userId);
          Object.assign(binding, { 'X-Calendar-Draft-Id': target.draftId, 'X-Calendar-Revision': target.revision, 'X-Calendar-Image-Sha256': target.imageSha256, 'X-Calendar-Status': String(draft.status) });
        } catch { /* Read-only when approval credential is not configured. */ }
      } else if (draft.schemaVersion !== undefined && draft.schemaVersion !== 1) throw new Error();
      return new Response(new Uint8Array(png), { headers: { ...headers, ...binding, 'Content-Type': 'image/png', 'Content-Length': String(png.length), 'X-Calendar-Year-Month': metadata.yearMonth, 'X-Calendar-Generated-At': metadata.generatedAt } });
    } catch (error) {
      if (error instanceof CalendarBridgeHttpError) return failure('draft_upstream', '下書き取得先でエラーが発生しました');
      return signal.aborted ? failure('draft_timeout', '下書き取得がタイムアウトしました', 504) : failure('draft_invalid_response', '下書き取得先から有効なPNGと日時情報を取得できませんでした');
    }
  },
};
