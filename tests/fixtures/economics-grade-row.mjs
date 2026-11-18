/** Synthetic 24-cell grade row: aggregate4, communication2 and winter schooling2. */
export function economicsGradeCells(schoolingSlot = 0) {
  const cells = Array(24).fill('');
  Object.assign(cells, { 1: '経済学', 2: '4', 5: '4', 6: '2', 7: '○27/02/01', 11: '2027/03/01', 12: '2', 13: 'S' });
  const start = schoolingSlot === 0 ? 14 : 19;
  ['2026', '冬期', '2027/02/01', '2', 'A'].forEach((value, index) => { cells[start + index] = value; });
  return cells;
}
