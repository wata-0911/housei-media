import type { DeepReadonly } from '../../src/planner/attempts/gradeImport/sourceArchive.ts';
import type { Operation } from '../../src/planner/attempts/gradeImport/ledger.ts';
import { previewImport, type ImportPreview } from '../../src/planner/attempts/gradeImport/preview.ts';
function boundary(p: DeepReadonly<ImportPreview>) {
  // @ts-expect-error preview is not a journal operation
  const op: Operation = p;
  // @ts-expect-error immutable official quantity
  p.rows[0].record.earnedCredits.value = 2;
  // @ts-expect-error no selected identity
  p.rows[0].selectedAchievementId = 'guessed';
  const cannotCommit: false = p.authorization.canCommit;
  void op; void cannotCommit;
}
void boundary;
// @ts-expect-error known reservation floor must be passed explicitly
void previewImport('{}', '{}');
