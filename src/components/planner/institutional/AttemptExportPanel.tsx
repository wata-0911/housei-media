import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toPng } from 'html-to-image';
import { ATTEMPT_EXPORT_COLUMNS, attemptExportCsv, attemptExportPresentation, exportPin,
  type AttemptExportPresentation } from '../../../planner/attempts/exports/attemptExport';
import type { AcSnapshot, SavedInventory } from '../../../planner/attempts/production/acController';
import { preparePngData } from '../../../planner/exports/pngExport';

type LocalInputs = ReadonlySet<string>;
export type AttemptExportReceipt = Readonly<{
  state: AcSnapshot;
  inputs: LocalInputs;
  pin: SavedInventory;
  isCurrent: () => boolean;
}>;
type Preview = Readonly<{
  receipt: AttemptExportReceipt;
  presentation: AttemptExportPresentation;
  dataUrl: string;
  blob: Blob;
}>;
const RECHECK = '出力を保留しました。未保存の入力を解決し、保存内容を再読込・照合してください。';

function download(blob: Blob, extension: 'csv' | 'png') {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = '保存済み履修計画.' + extension;
  anchor.href = url;
  try { anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

async function localPngReader(url: string) {
  const prefix = 'data:image/png;base64,';
  if (!url.startsWith(prefix)) throw new Error('invalid_local_png');
  const bytes = Uint8Array.from(atob(url.slice(prefix.length)), char => char.charCodeAt(0));
  return { ok: true, blob: async () => new Blob([bytes], { type: 'image/png' }) };
}

export function AttemptExportPanel({ state, inputs, readingFile, verify }: {
  state: AcSnapshot;
  inputs: LocalInputs;
  readingFile: boolean;
  verify: () => Promise<AttemptExportReceipt | null>;
}) {
  const inProgress = useRef(false);
  const imageRoot = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [rendering, setRendering] = useState<AttemptExportPresentation | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const eligible = !!exportPin(state, !!inputs.size || readingFile);
  const currentPreview = eligible && preview?.receipt.state === state && preview.receipt.inputs === inputs ? preview : null;

  async function run(action: 'csv' | 'preview' | 'savePng') {
    if (inProgress.current) return;
    if (action === 'savePng' && !currentPreview?.receipt.isCurrent()) {
      setMessage(RECHECK);
      return;
    }
    inProgress.current = true;
    setPending(true);
    setMessage('');
    setPreview(null);
    try {
      const receipt = await verify();
      if (!receipt?.isCurrent()) { setMessage(RECHECK); return; }
      const presentation = attemptExportPresentation(receipt.pin);
      if (action === 'csv') {
        download(new Blob([attemptExportCsv(presentation)], { type: 'text/csv;charset=utf-8' }), 'csv');
        setMessage('照合した保存済み履修計画の CSV をダウンロードしました。');
        return;
      }
      if (action === 'savePng') {
        if (!currentPreview || JSON.stringify(presentation) !== JSON.stringify(currentPreview.presentation)) {
          setMessage(RECHECK);
          return;
        }
        download(currentPreview.blob, 'png');
        setPreview({ ...currentPreview, receipt });
        setMessage('照合した保存済み履修計画の PNG をダウンロードしました。');
        return;
      }
      flushSync(() => setRendering(presentation));
      const node = imageRoot.current;
      if (!receipt.isCurrent()) { setMessage(RECHECK); return; }
      if (!node || node.scrollHeight > 7500) throw new Error('png_layout_unavailable');
      const image = await preparePngData(node, toPng, localPngReader, { cacheBust: false });
      if (!receipt.isCurrent()) { setMessage(RECHECK); return; }
      setPreview({ receipt, presentation, ...image });
      setMessage('照合済みの画像を確認できます。保存時にも再照合します。');
    } catch {
      setMessage('出力できませんでした。保存内容を再読込・照合してください。画像が大きい場合は CSV をお使いください。');
    } finally {
      setRendering(null);
      inProgress.current = false;
      setPending(false);
    }
  }

  return <section aria-label="保存済み履修計画の出力">
    <h2>保存済み履修計画の出力</h2>
    <p>照合時点の保存正本を端末内で出力します。本人入力と旧公式原行は別区分です。公式な卒業判定には使えません。</p>
    <button disabled={!eligible || pending} onClick={() => void run('csv')}>保存済み履修計画をCSV出力</button>
    <button disabled={!eligible || pending} onClick={() => void run('preview')}>同じ履修計画をPNGで確認</button>
    {!eligible && !pending && <p>{RECHECK}</p>}
    {message && <p role="status" data-testid="attempt-export-message">{message}</p>}
    {currentPreview && <>
      <img alt="照合した保存済み履修計画のプレビュー" src={currentPreview.dataUrl} style={{ maxWidth: '100%' }} />
      <button disabled={pending} onClick={() => void run('savePng')}>確認したPNGを保存</button>
    </>}
    {rendering && <div aria-hidden="true" style={{ position: 'fixed', left: -12000, top: 0, pointerEvents: 'none' }}>
      <div ref={imageRoot} data-testid="attempt-export-render"
        style={{ width: 920, padding: 24, boxSizing: 'border-box', color: '#18243b', fontFamily: 'sans-serif',
          backgroundColor: '#fffaf3', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        <h2>保存済み履修計画</h2>
        {rendering.rows.map((row, index) =>
          <dl key={index} data-export-row style={{ borderTop: '1px solid #8b8075', padding: '8px 0',
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 16px' }}>
            {row.map((value, column) => <div key={ATTEMPT_EXPORT_COLUMNS[column]}
              style={column === 10 ? { gridColumn: '1 / -1' } : undefined}>
              <dt style={{ fontWeight: 'bold', display: 'inline' }}>{ATTEMPT_EXPORT_COLUMNS[column]} </dt>
              <dd data-export-value style={{ display: 'inline', margin: 0 }}>{value}</dd>
            </div>)}
          </dl>)}
      </div>
    </div>}
  </section>;
}
