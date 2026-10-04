/* Read-only parser. It deliberately has no network APIs, storage, or page mutations. */
// Keep only our own safe failure identity. Never inspect/rethrow a page Error,
// including its prototype, message, stack, cause or arbitrary properties.
let lastFailure;
const boundary = (code, context, action) => {
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
const extractCurrentDocument = () => boundary('GI_EXTRACT_EXCEPTION', { __proto__: null }, () => {
  checkInitialization();
  const candidates = boundary('GI_EXTRACT_TABLE_QUERY', { __proto__: null }, () => Array.from(document.querySelectorAll('table[id="seisekiTabele110"]'), inspectTable));
  if (candidates.length === 0) return { ok: false, reason: 'table_not_found', diagnostics: boundary('GI_EXTRACT_DIAGNOSTICS', { __proto__: null }, () => diagnosticsFor(candidates)) };
  const { selected, tieCandidateIndexes } = boundary('GI_EXTRACT_CANDIDATE_SELECT', { __proto__: null }, () => selectCandidate(candidates));
  const context = { __proto__: null, tableIndex: selected.index };
  const diagnostics = boundary('GI_EXTRACT_DIAGNOSTICS', context, () => diagnosticsFor(candidates, selected.index, tieCandidateIndexes));
  if (selected.courseRowCount === 0) return { ok: false, reason: 'course_rows_not_found', diagnostics };
  const capturedAt = boundary('GI_EXTRACT_CAPTURE_TIME', context, () => new Date().toISOString());
  return { ok: true, value: { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt, courses: extractRows(selected.rows, context) }, diagnostics };
});

export { date, report, extractRows, extractCurrentDocument, isSafeExtractionFailure };
