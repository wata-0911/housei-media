import { createHmac, timingSafeEqual } from 'node:crypto';
export type CalendarTarget = { yearMonth: string; fileId: string; generatedAt: string; revision: string; draftId: string; imageSha256: string };
export function parseTarget(data: Record<string, unknown>): CalendarTarget {
  if (typeof data.yearMonth !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(data.yearMonth) ||
      typeof data.fileId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(data.fileId) ||
      typeof data.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.generatedAt) || new Date(data.generatedAt).toISOString() !== data.generatedAt ||
      typeof data.revision !== 'string' || !/^[1-9][0-9]{0,29}$/.test(data.revision) ||
      typeof data.draftId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.draftId) ||
      typeof data.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.imageSha256)) throw new Error('Invalid target');
  return { yearMonth: data.yearMonth, fileId: data.fileId, generatedAt: data.generatedAt, revision: data.revision, draftId: data.draftId, imageSha256: data.imageSha256 };
}
export function approvalSecret(): string {
  const secret = process.env.GAS_CALENDAR_APPROVAL_SECRET;
  if (!secret || secret.length < 32 || secret.length > 1024 || secret === process.env.GAS_CALENDAR_DRAFT_SECRET || secret === process.env.GAS_CALENDAR_SYNC_WRITE_SECRET) throw new Error('Approval configuration');
  return secret;
}
// Derive a receipt-only subkey, never expose the upstream approval credential.
function signature(payload: string): Buffer {
  const key = createHmac('sha256', approvalSecret()).update('calendar-preview-receipt-key:v1').digest();
  return createHmac('sha256', key).update(payload).digest();
}
export function previewReceipt(target: CalendarTarget, userId: string): string {
  const payload = Buffer.from(JSON.stringify({ domain: 'calendar-preview:v1', target, userId, expiresAt: Date.now() + 10 * 60_000 })).toString('base64url');
  return payload + '.' + signature(payload).toString('base64url');
}
export function verifyPreviewReceipt(value: unknown, actor: string): CalendarTarget {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid receipt');
  const [payload, mac] = value.split('.');
  const expected = signature(payload), actual = Buffer.from(mac, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid receipt');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (data.domain !== 'calendar-preview:v1' || data.userId !== actor || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 10 * 60_000) throw new Error('Expired receipt');
  return parseTarget(data.target);
}
