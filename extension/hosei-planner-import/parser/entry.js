import { date, report, extractRows, extractCurrentDocument } from '../../../shared/grade-import/extractor.js';

// Preserve the isolated-world API used by popup.js and existing integrations.
globalThis.HoseiPlannerGradeExtractor = { date, report, extractRows, extractCurrentDocument };
