/* Read-only parser. It deliberately has no network APIs, storage, or page mutations. */
// Keep only our own safe failure identity. Never inspect/rethrow a page Error,
// including its prototype, message, stack, cause or arbitrary properties.
let lastFailure;
const boundary = (code, context, action, field) => {
  try { return action(); }
  catch (error) {
    if (error === lastFailure && lastFailure !== undefined) throw lastFailure;
    const failure = { __proto__: null, code };
    // Coordinates originate from traversal callbacks, but reject hostile indexes.
    const coordinate = key => {
      try {
        const index = context[key];
        if (typeof index === 'number' && index >= 0 && index % 1 === 0 && index <= 9007199254740991) failure[key] = index;
      } catch { /* A diagnostic coordinate must never obscure the stage. */ }
    };
    // Do not depend on array iterators/map/filter when reporting their failure.
    coordinate('tableIndex'); coordinate('rowIndex'); coordinate('cellIndex');
    // Only compile-time schema labels; never stringify an arbitrary field/value.
    if (field === 'candidates' || field === 'candidates.length' || field === 'selection' || field === 'selected' || field === 'tieCandidateIndexes' || field === 'selected.index' || field === 'selected.courseRowCount' || field === 'selected.rows' || field === 'result') failure.field = field;
    lastFailure = failure;
    throw failure;
  }
};
// A boolean API for the Bookmarklet catch: it never reads an untrusted throwable.
const isSafeExtractionFailure = error => error === lastFailure && lastFailure !== undefined;
let GRADES;
let initializationFailed = false;
try { GRADES = new Set(['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D']); }
catch { initializationFailed = true; }
const checkInitialization = () => boundary('GI_EXTRACT_INITIALIZE', { __proto__: null }, () => {
  if (initializationFailed) throw null;
});
const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').trim();
// `*4` means a pending marker plus four credits, not an unknown credit value.
const numberField = raw => { const text = clean(raw).replace(/^\*/, ''); return { raw, value: /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null }; };
const grade = raw => GRADES.has(clean(raw)) ? clean(raw) : null;
const date = raw => {
  const match = clean(raw).match(/^(?:(\d{2})|\d{4})[/.年](\d{1,2})[/.月](\d{1,2})(?:日)?$/);
  if (!match) return null;
  const year = match[1] ? 2000 + Number(match[1]) : Number(clean(raw).match(/^\d{4}/)[0]);
  const month = Number(match[2]); const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
};
const report = raw => {
  const text = clean(raw); const marker = text.charAt(0); const reportDate = date(text.slice(1));
  return { raw: text, status: text === '' ? 'none' : marker === '○' ? 'passed' : marker === '×' ? 'resubmit' : marker === '*' ? 'processing' : 'unknown', date: reportDate };
};
const schooling = cells => ({ rawYear: cells[0], rawTerm: cells[1], rawDate: cells[2], rawCredits: cells[3], rawGrade: cells[4], year: clean(cells[0]) || null, term: clean(cells[1]) || null, date: date(cells[2]), credits: numberField(cells[3]).value, grade: grade(cells[4]) });
const course = (cells, categoryRaw) => ({
  rawName: clean(cells[1]), categoryRaw,
  compositionCredits: numberField(cells[2]), additionalEnrollment: numberField(cells[3]), recognizedExemption: numberField(cells[4]), earnedCredits: numberField(cells[5]), schoolingCredits: numberField(cells[6]),
  reports: [report(cells[7]), report(cells[8]), report(cells[9]), report(cells[10])],
  creditExam: { rawDate: cells[11], rawCredits: cells[12], rawGrade: cells[13], date: date(cells[11]), credits: numberField(cells[12]).value, grade: grade(cells[13]), pendingMarker: clean(cells[12]).includes('*') },
  schoolings: [schooling(cells.slice(14, 19)), schooling(cells.slice(19, 24))]
});
const cellsForRow = (row, context = { __proto__: null }) => {
  const physicalCells = boundary('GI_EXTRACT_CELL_QUERY', context, () => Array.from(row.querySelectorAll('td')));
  let nextLogicalCellIndex = 0;
  const cells = boundary('GI_EXTRACT_CELL_FILTER', context, () => physicalCells.filter(cell => {
    const keep = boundary('GI_EXTRACT_CELL_FILTER', { __proto__: null, ...context, cellIndex: nextLogicalCellIndex }, () => !cell.classList.contains('line_y_label'));
    if (keep) nextLogicalCellIndex++;
    return keep;
  }));
  return boundary('GI_EXTRACT_CELL_TEXT', context, () => cells.map((cell, cellIndex) =>
    boundary('GI_EXTRACT_CELL_TEXT', { __proto__: null, ...context, cellIndex }, () => clean(cell.textContent))));
};
const isCategoryRow = cells => cells.length === 24 && clean(cells[1]).startsWith('***');
const isCourseRow = cells => cells.length === 24 && !isCategoryRow(cells) && clean(cells[1]) !== '';
const extractRows = (rows, context = { __proto__: null }) => boundary('GI_EXTRACT_COURSE_PARSE', context, () => {
  checkInitialization();
  let categoryRaw = null; const courses = [];
  let rowIndex = 0;
  for (const row of rows) {
    const rowContext = { __proto__: null, ...context, rowIndex };
    boundary('GI_EXTRACT_COURSE_PARSE', rowContext, () => {
      const cells = Array.isArray(row) ? row.map(clean) : cellsForRow(row, rowContext);
      if (boundary('GI_EXTRACT_ROW_CLASSIFY', rowContext, () => cells.length !== 24)) return;
      if (boundary('GI_EXTRACT_ROW_CLASSIFY', rowContext, () => isCategoryRow(cells))) { categoryRaw = clean(cells[1]); return; }
      if (boundary('GI_EXTRACT_ROW_CLASSIFY', rowContext, () => clean(cells[1]) !== '')) courses.push(course(cells, categoryRaw));
    });
    rowIndex++;
  }
  return courses;
});
const inspectTable = (table, index) => boundary('GI_EXTRACT_TABLE_INSPECT', { __proto__: null, tableIndex: index }, () => {
  const context = { __proto__: null, tableIndex: index };
  const logicalRows = boundary('GI_EXTRACT_ROW_QUERY', context, () =>
    Array.from(table.querySelectorAll('tr.column_even, tr.column_odd'), (row, rowIndex) => cellsForRow(row, { __proto__: null, ...context, rowIndex })));
  // Preserve original row indexes after the existing 24-cell filter, solely for diagnostics.
  const validRowIndexes = [];
  const classify = (cells, rowIndex, predicate) => boundary('GI_EXTRACT_ROW_CLASSIFY', { __proto__: null, ...context, rowIndex }, () => predicate(cells));
  const validRows = boundary('GI_EXTRACT_ROW_CLASSIFY', context, () => logicalRows.filter((cells, rowIndex) => {
    const valid = classify(cells, rowIndex, row => row.length === 24);
    if (valid) validRowIndexes.push(rowIndex);
    return valid;
  }));
  const courseRows = boundary('GI_EXTRACT_ROW_CLASSIFY', context, () => validRows.filter((cells, validIndex) => classify(cells, validRowIndexes[validIndex], isCourseRow)));
  return {
    index,
    rows: logicalRows,
    courseRows,
    rowCount: logicalRows.length,
    valid24RowCount: validRows.length,
    categoryRowCount: boundary('GI_EXTRACT_ROW_CLASSIFY', context, () => validRows.filter((cells, validIndex) => classify(cells, validRowIndexes[validIndex], isCategoryRow)).length),
    courseRowCount: courseRows.length
  };
});
const diagnosticsFor = (candidates, selectedCandidateIndex = null, tieCandidateIndexes = []) => ({
  tableCandidates: candidates.map(({ index, rowCount, valid24RowCount, categoryRowCount, courseRowCount }) => ({ index, rowCount, valid24RowCount, categoryRowCount, courseRowCount })),
  selectedCandidateIndex,
  tieCandidateIndexes
});
const selectCandidate = candidates => {
  const largestCourseRowCount = Math.max(...candidates.map(candidate => candidate.courseRowCount));
  const tied = candidates.filter(candidate => candidate.courseRowCount === largestCourseRowCount);
  if (tied.length === 1) return { selected: tied[0], tieCandidateIndexes: [] };
  return { selected: tied[0], tieCandidateIndexes: tied.map(candidate => candidate.index) };
};
// Internal result guards diagnose hostile return values; they never repair,
// coerce or copy parser data. Normal native arrays/records pass unchanged.
const isCount = value => typeof value === 'number' && value >= 0 && value % 1 === 0 && value <= 9007199254740991;
const requireArray = value => { if (!Array.isArray(value)) throw null; return value; };
const requireRecord = value => { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw null; return value; };
const tableResultLength = candidates => {
  boundary('GI_EXTRACT_TABLE_RESULT', { __proto__: null }, () => requireArray(candidates), 'candidates');
  return boundary('GI_EXTRACT_TABLE_RESULT', { __proto__: null }, () => {
    const length = candidates.length;
    if (!isCount(length)) throw null;
    return length;
  }, 'candidates.length');
};
const readCandidateResult = result => {
  const context = { __proto__: null };
  boundary('GI_EXTRACT_CANDIDATE_RESULT', context, () => requireRecord(result), 'selection');
  const selected = boundary('GI_EXTRACT_CANDIDATE_RESULT', context, () => requireRecord(result.selected), 'selected');
  const tieCandidateIndexes = boundary('GI_EXTRACT_CANDIDATE_RESULT', context, () => requireArray(result.tieCandidateIndexes), 'tieCandidateIndexes');
  return { selected, tieCandidateIndexes };
};
const selectedIndex = selected => boundary('GI_EXTRACT_SELECTED_RESULT', { __proto__: null }, () => {
  const index = selected.index;
  if (!isCount(index)) throw null;
  return index;
}, 'selected.index');
const selectedCourseCount = (selected, context) => boundary('GI_EXTRACT_SELECTED_RESULT', context, () => {
  const count = selected.courseRowCount;
  if (!isCount(count)) throw null;
  return count;
}, 'selected.courseRowCount');
const selectedRows = (selected, context) => boundary('GI_EXTRACT_SELECTED_RESULT', context, () => requireArray(selected.rows), 'selected.rows');
const checkDiagnosticsShape = diagnostics => {
  requireRecord(diagnostics);
  const tables = requireArray(diagnostics.tableCandidates);
  const ties = requireArray(diagnostics.tieCandidateIndexes);
  // Diagnostics reach a console sink. Reject wrong-shape map returns before
  // logging, including extra enumerable properties; never print their values.
  if (Object.keys(diagnostics).length !== 3 || Object.keys(tables).length !== tables.length || Object.keys(ties).length !== ties.length) throw null;
  if (diagnostics.selectedCandidateIndex !== null && !isCount(diagnostics.selectedCandidateIndex)) throw null;
  for (let i = 0; i < tables.length; i++) {
    const table = requireRecord(tables[i]);
    if (Object.keys(table).length !== 5 || !isCount(table.index) || !isCount(table.rowCount) || !isCount(table.valid24RowCount) || !isCount(table.categoryRowCount) || !isCount(table.courseRowCount)) throw null;
  }
  for (let i = 0; i < ties.length; i++) if (!isCount(ties[i])) throw null;
};
const finalizeExtraction = (context, assemble) => boundary('GI_EXTRACT_FINALIZE', context, () => {
  const result = requireRecord(assemble());
  checkDiagnosticsShape(result.diagnostics);
  if (result.ok === true) {
    const value = requireRecord(result.value);
    requireArray(value.courses);
    if (value.schemaVersion !== 1 || value.source !== 'hosei_web_learning_grade_table' || typeof value.capturedAt !== 'string') throw null;
  } else if (result.ok !== false || (result.reason !== 'table_not_found' && result.reason !== 'course_rows_not_found')) throw null;
  return result;
}, 'result');
const extractCurrentDocument = () => boundary('GI_EXTRACT_EXCEPTION', { __proto__: null }, () => {
  checkInitialization();
  const candidates = boundary('GI_EXTRACT_TABLE_QUERY', { __proto__: null }, () => Array.from(document.querySelectorAll('table[id="seisekiTabele110"]'), inspectTable));
  if (tableResultLength(candidates) === 0) return finalizeExtraction({ __proto__: null }, () => ({ ok: false, reason: 'table_not_found', diagnostics: boundary('GI_EXTRACT_DIAGNOSTICS', { __proto__: null }, () => diagnosticsFor(candidates)) }));
  const selection = boundary('GI_EXTRACT_CANDIDATE_SELECT', { __proto__: null }, () => selectCandidate(candidates));
  const { selected, tieCandidateIndexes } = readCandidateResult(selection);
  const context = { __proto__: null, tableIndex: selectedIndex(selected) };
  const diagnostics = boundary('GI_EXTRACT_DIAGNOSTICS', context, () => diagnosticsFor(candidates, context.tableIndex, tieCandidateIndexes));
  if (selectedCourseCount(selected, context) === 0) return finalizeExtraction(context, () => ({ ok: false, reason: 'course_rows_not_found', diagnostics }));
  const capturedAt = boundary('GI_EXTRACT_CAPTURE_TIME', context, () => new Date().toISOString());
  const rows = selectedRows(selected, context);
  const courses = extractRows(rows, context);
  return finalizeExtraction(context, () => ({ ok: true, value: { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt, courses }, diagnostics }));
});

export { date, report, extractRows, extractCurrentDocument, isSafeExtractionFailure };
// Internal ESM helpers for identity/result-boundary tests; not extension globals.
export { boundary, readCandidateResult, finalizeExtraction };
