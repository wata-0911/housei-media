import type { PlannerCatalog } from '../../plannerCatalog';
import { decodeMigrationSource, parseMigrationJson, prepareMigrationEnvironment } from '../migration/source';
import { prepareMigrationIds } from '../migration/assignments';
import { previewMigration } from '../migration/preview';
import { freeze, type DecodeResult, type IdAssignments, type PreviewResult } from '../migration/contracts';

export type MigrationSession = { raw: string; decoded: DecodeResult; table: IdAssignments | null; preview: PreviewResult | null; reservedIds: string[] };
export type DateCorrection = { original: MigrationSession; offeringId: string; assessmentId: string; oldDate: string; newDate: string | null; proposedRaw: string };
export function heldDates(session: MigrationSession) {
  if (session.decoded.status !== 'decoded' || session.preview?.status !== 'held') return [];
  return session.preview.diagnostics.filter(d => d.code === 'assessment_date').map(d => {
    const original = d.original as { offeringId: string; assessment: { id: string; scheduledDate: string }; owner: unknown };
    return { offeringId: original.offeringId, assessmentId: original.assessment.id, date: original.assessment.scheduledDate, owner: original.owner };
  });
}
/** Page-lifetime cache; repeat previews keep the same issuance receipt. No persistence or legacy projection. */
export function createMigrationWorkbench(environment: Awaited<ReturnType<typeof prepareMigrationEnvironment>>, localCatalog: PlannerCatalog) {
  const sessions = new Map<string, MigrationSession>();
  const pending = new Map<string, Promise<MigrationSession>>();
  const proposals = new WeakSet<object>();
  const issuedIds = new Set<string>();
  async function inspect(raw: string): Promise<MigrationSession> {
    if (sessions.has(raw)) return sessions.get(raw)!;
    if (pending.has(raw)) return pending.get(raw)!;
    const task = (async () => {
      const decoded = await decodeMigrationSource(raw, environment, localCatalog);
      const reservedIds = [...issuedIds];
      const table = decoded.status === 'decoded' ? prepareMigrationIds(decoded.source, reservedIds) : null;
      const preview = decoded.status === 'decoded' && table ? previewMigration(decoded.source, table, reservedIds) : null;
      const session = freeze({ raw, decoded, table, preview, reservedIds });
      table?.attempts.forEach(a => { issuedIds.add(a.attemptId); issuedIds.add(a.operationId); });
      table?.records.forEach(r => issuedIds.add(r.recordId));
      sessions.set(raw, session); return session;
    })();
    pending.set(raw, task);
    try { return await task; } finally { pending.delete(raw); }
  }
  function requireSession(session: MigrationSession) {
    if (sessions.get(session.raw) !== session) throw new Error('unknown_migration_session');
  }
  function repeat(session: MigrationSession): PreviewResult | null {
    requireSession(session);
    return session.decoded.status === 'decoded' && session.table
      ? previewMigration(session.decoded.source, session.table, session.reservedIds) : null;
  }
  function proposeDate(session: MigrationSession, offeringId: string, assessmentId: string, newDate: string | null): DateCorrection {
    requireSession(session);
    const proposal = dateCorrectionProposal(session, offeringId, assessmentId, newDate);
    proposals.add(proposal); return proposal;
  }
  async function confirmDate(proposal: DateCorrection, confirmed: boolean) {
    if (!confirmed || !proposals.has(proposal)) throw new Error('explicit_confirmation_required');
    requireSession(proposal.original);
    // Original text/receipt are still cached. New digest receives a distinct assignment, never borrowed IDs.
    return inspect(proposal.proposedRaw);
  }
  return { inspect, repeat, proposeDate, confirmDate };
}

/** Pure proposal builder; confirmation still requires a controller-issued handle. */
export function dateCorrectionProposal(session: MigrationSession, offeringId: string, assessmentId: string, newDate: string | null): DateCorrection {
  const row = heldDates(session).find(d => d.offeringId === offeringId && d.assessmentId === assessmentId);
  if (!row) throw new Error('not_a_held_date');
  if (newDate !== null) {
    const parsed = new Date(`${newDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || newDate.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== newDate) throw new Error('assessment_date: 実在日付または明示nullを指定してください');
  }
  const value = parseMigrationJson(session.raw) as Record<string, unknown>;
  const state = ('format' in value ? value.state : value) as { mediaSchoolingProgress: Record<string, { assessments: { id: string; scheduledDate: string | null }[] }> };
  const assessment = state.mediaSchoolingProgress[offeringId].assessments.find(a => a.id === assessmentId)!;
  assessment.scheduledDate = newDate;
  return freeze({ original: session, offeringId, assessmentId, oldDate: row.date, newDate, proposedRaw: JSON.stringify(value, null, 2) });
}
