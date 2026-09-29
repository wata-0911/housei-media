/* Read-only parser. It deliberately has no network APIs, storage, or page mutations. */
(() => {
  const GRADES = new Set(['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D']);
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
  const cellsForRow = row => Array.from(row.querySelectorAll('td')).filter(cell => !cell.classList.contains('line_y_label')).map(cell => clean(cell.textContent));
  const isCategoryRow = cells => cells.length === 24 && clean(cells[1]).startsWith('***');
  const isCourseRow = cells => cells.length === 24 && !isCategoryRow(cells) && clean(cells[1]) !== '';
  const extractRows = rows => {
    let categoryRaw = null; const courses = [];
    for (const row of rows) { const cells = Array.isArray(row) ? row.map(clean) : cellsForRow(row); if (cells.length !== 24) continue; if (isCategoryRow(cells)) { categoryRaw = clean(cells[1]); continue; } if (clean(cells[1]) !== '') courses.push(course(cells, categoryRaw)); }
    return courses;
  };
  const inspectTable = (table, index) => {
    const logicalRows = Array.from(table.querySelectorAll('tr.column_even, tr.column_odd'), cellsForRow);
    const validRows = logicalRows.filter(cells => cells.length === 24);
    const courseRows = validRows.filter(isCourseRow);
    return {
      index,
      rows: logicalRows,
      courseRows,
      rowCount: logicalRows.length,
      valid24RowCount: validRows.length,
      categoryRowCount: validRows.filter(isCategoryRow).length,
      courseRowCount: courseRows.length
    };
  };
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
  const extractCurrentDocument = () => {
    const candidates = Array.from(document.querySelectorAll('table[id="seisekiTabele110"]'), inspectTable);
    if (candidates.length === 0) return { ok: false, reason: 'table_not_found', diagnostics: diagnosticsFor(candidates) };
    const { selected, tieCandidateIndexes } = selectCandidate(candidates);
    const diagnostics = diagnosticsFor(candidates, selected.index, tieCandidateIndexes);
    if (selected.courseRowCount === 0) return { ok: false, reason: 'course_rows_not_found', diagnostics };
    return { ok: true, value: { schemaVersion: 1, source: 'hosei_web_learning_grade_table', capturedAt: new Date().toISOString(), courses: extractRows(selected.rows) }, diagnostics };
  };
  globalThis.HoseiPlannerGradeExtractor = { date, report, extractRows, extractCurrentDocument };
})();
