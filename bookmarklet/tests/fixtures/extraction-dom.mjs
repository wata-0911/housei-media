// Synthetic only. No real-page HTML, names, grades or identifiers are stored.
import assert from 'node:assert/strict';
import vm from 'node:vm';
export const capturedAt = '2026-10-04T00:00:00.000Z';
export const cells = (name, overrides = {}) => Array.from({ length: 24 }, (_, i) => overrides[i] ?? (i === 1 ? name : ''));
export const rows32 = () => Array.from({ length: 8 }, (_, group) => [
  cells(`***区分${group}`),
  ...Array.from({ length: 4 }, (_, i) => cells(group === 0 && i === 0 ? '論理学' : `科目${group * 4 + i}`, {
    2: '4', 5: '4', 7: '○26/06/01', 8: '×2026/06/15', 9: '*確認中', 10: '保留',
    11: '2026年7月1日', 12: '*4', 13: 'A', 16: '2026/02/30',
  })),
]).flat();
export function harness(logicalTables = [[], [], rows32(), rows32()]) {
  const tables = logicalTables.map(logicalRows => {
    const rows = logicalRows.map(row => {
      const physicalCells = [
        { textContent: '除外ラベル', classList: { contains: name => name === 'line_y_label' } },
        ...row.map(textContent => ({ textContent, classList: { contains: () => false } })),
      ];
      return { physicalCells, querySelectorAll(selector) { assert.equal(selector, 'td'); return physicalCells; } };
    });
    return { rows, querySelectorAll(selector) { assert.equal(selector, 'tr.column_even, tr.column_odd'); return rows; } };
  });
  const alerts = [], logs = [], copied = [];
  const document = { querySelectorAll(selector) { assert.equal(selector, 'table[id="seisekiTabele110"]'); return tables; } };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [capturedAt])); } }
  const context = vm.createContext({ document, Date: FixedDate,
    location: { protocol: 'https:', hostname: 'www.tsukyo.hosei.ac.jp' },
    navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    alert: text => alerts.push(text),
    console: Object.fromEntries(['info', 'log', 'warn', 'error', 'debug'].map(key => [key, (...args) => logs.push(args)])),
  });
  return { context, document, tables, alerts, logs, copied };
}
