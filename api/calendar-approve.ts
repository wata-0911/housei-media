import { verifyCalendarRequest } from '../server/calendar-authorization.js';
import { approvalSecret, parseTarget, verifyPreviewReceipt } from '../server/calendar-approval.js';
import { calendarBridgeUrl, callCalendarBridge } from '../server/calendar-bridge.js';
import { calendarDeploymentAllowed, calendarUnavailable } from '../server/calendar-deployment.js';
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
const fail = (code: string, status: number) => Response.json({ ok: false, code }, { status, headers });
export default {
  async fetch(request: Request): Promise<Response> {
    if (!calendarDeploymentAllowed()) return calendarUnavailable();
    const authorization = await verifyCalendarRequest(request.clone());
    if (authorization instanceof Response) return authorization;
    let secret: string;
    try { secret = approvalSecret(); calendarBridgeUrl(); } catch { return fail('approval_server_config', 503); }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('approval_invalid_request', 400);
    let target;
    try { target = verifyPreviewReceipt(body.previewReceipt, authorization.userId); } catch { return fail('preview_receipt_invalid', 401); }
    if (body.draftId !== target.draftId || body.revision !== target.revision || body.imageSha256 !== target.imageSha256) return fail('preview_target_mismatch', 409);
    const signal = AbortSignal.timeout(15_000);
    try {
      const value = await callCalendarBridge({ action: 'approve_current_draft_v1', secret, actor: { userId: authorization.userId }, target }, signal);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const result = value as Record<string, unknown>;
      if (result.ok !== true) {
        if (['STALE_DRAFT', 'IMAGE_CHANGED', 'SAVE_PENDING', 'RESERVATION_EXPIRED_RECOVERY_REQUIRED', 'RESERVATION_ROLLOUT_REQUIRED', 'APPROVAL_DISABLED'].includes(String(result.code))) return fail(String(result.code), 409);
        if (result.code === 'MIGRATION_REQUIRED') return fail('approval_not_ready', 409);
        return fail('approval_result_unknown', 502);
      }
      const returned = parseTarget(result);
      if (JSON.stringify(returned) !== JSON.stringify(target) || result.status !== 'approved' ||
          !['APPROVED', 'ALREADY_APPROVED', 'ALREADY_APPROVED_BY_OTHER'].includes(String(result.code)) ||
          typeof result.approvedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.approvedAt) || new Date(result.approvedAt).toISOString() !== result.approvedAt) throw new Error();
      return Response.json({ ok: true, code: result.code, draftId: target.draftId, revision: target.revision, imageSha256: target.imageSha256, status: 'approved', approvedAt: result.approvedAt }, { headers });
    } catch { return fail(signal.aborted ? 'approval_timeout_unknown' : 'approval_result_unknown', signal.aborted ? 504 : 502); }
  },
};
