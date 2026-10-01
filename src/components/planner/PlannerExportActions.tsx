import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { exportGradeLabel, exportStudyYearLabel, exportTermLabel, exportValue, plannerExportCsv, plannerExportFileName, type PlannerExportPresentation, type PlannerExportRow } from '../../planner/plannerExport';

type Props = { presentation: PlannerExportPresentation };

// Keep Japanese glyphs and Latin numerals in one local serif family when the
// presentation is rasterized. These are OS-provided fonts, so no web-font
// request or CORS-dependent font embedding is needed.
const exportImageFontFamily = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';

function downloadBlob(contents: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportRow({ row }: { row: PlannerExportRow }) {
  return <article className="border-t border-slate-200 py-4 first:border-t-0">
    <div className="flex items-start justify-between gap-5"><h4 className="min-w-0 break-words text-lg font-semibold text-[#002255]">{row.title}</h4><span className="shrink-0 text-sm">{exportValue(row.credits)}単位</span></div>
    <p className="mt-1 text-sm text-slate-600">{row.plannedYear === null ? '年度未設定' : `${row.plannedYear}年`} / {row.formLabel} / {exportTermLabel(row.plannedTerm)} / {row.statusLabel}</p>
    {row.classificationLabel && <p className="mt-1 text-xs text-slate-500">{row.classificationLabel}・{row.sourceType === 'catalog' ? 'catalog' : '公開科目'}</p>}
    <div className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"><span className="text-slate-500">進捗</span><span className="break-words">{row.progressSummary}</span><span className="text-slate-500">最終評価</span><span>{exportGradeLabel(row.finalGrade)}</span>{row.assessmentSummary && <><span className="text-slate-500">試験・評価予定</span><span className="break-words">{row.assessmentSummary}</span></>}</div>
  </article>;
}

function ExportImage({ presentation, date }: { presentation: PlannerExportPresentation; date: Date }) {
  const groups: Array<[PlannerExportRow['studyYear'], PlannerExportRow[]]> = [[1, presentation.rows.filter(row => row.studyYear === 1)], [2, presentation.rows.filter(row => row.studyYear === 2)], [3, presentation.rows.filter(row => row.studyYear === 3)], [4, presentation.rows.filter(row => row.studyYear === 4)], [null, presentation.rows.filter(row => row.studyYear === null)]];
  return <div className="w-[1000px] bg-[#fffaf3] p-10 text-[#18243b]" style={{ fontFamily: exportImageFontFamily }}>
    <p className="text-xs font-semibold tracking-[0.18em] text-[#a34700]">HOSEI TSUSHIN</p>
    <h3 className="mt-2 text-3xl font-semibold text-[#002255]">履修計画</h3>
    <div className="mt-4 border-y border-[#dfd4c5] py-3 text-sm"><p>所属 {presentation.affiliation}</p><p className="mt-1">出力日 {date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日</p></div>
    {groups.filter(([, rows]) => rows.length > 0).map(([year, rows]) => <section key={String(year)} className="mt-7"><h3 className="border-l-4 border-[#e65c00] bg-[#f8efe3] px-4 py-2 text-xl font-semibold text-[#002255]">{exportStudyYearLabel(year)}</h3><div className="px-3">{rows.map((row, index) => <ExportRow key={`${row.sourceType}-${row.title}-${index}`} row={row} />)}</div></section>)}
    {presentation.rows.length === 0 && <p className="mt-7 text-slate-600">履修計画はまだありません。</p>}
  </div>;
}

export default function PlannerExportActions({ presentation }: Props) {
  const imageRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [isSavingImage, setIsSavingImage] = useState(false);
  const now = new Date();
  const baseName = plannerExportFileName(now);
  const handleCsv = () => {
    downloadBlob(plannerExportCsv(presentation), `${baseName}.csv`, 'text/csv;charset=utf-8');
    setMessage('CSVを保存しました。');
  };
  const handlePng = async () => {
    if (!imageRef.current) return;
    setIsSavingImage(true); setMessage('画像を準備しています…');
    try {
      const dataUrl = await toPng(imageRef.current, { backgroundColor: '#fffaf3', pixelRatio: 2, cacheBust: true, skipFonts: true });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${baseName}.png`;
      link.click();
      setMessage('画像を保存しました。');
    } catch { setMessage('画像を作成できませんでした。もう一度お試しください。'); } finally { setIsSavingImage(false); }
  };
  return <section aria-label="履修計画の保存" className="flex flex-wrap items-center gap-2 border border-gray-200 bg-white p-4 sm:p-5">
    <button type="button" onClick={handleCsv} className="border border-[#002255] px-3 py-2 text-sm text-[#002255]">CSVで保存</button>
    <button type="button" onClick={handlePng} disabled={isSavingImage} className="border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">{isSavingImage ? '画像を作成中…' : '画像で保存'}</button>
    <p className="basis-full text-xs text-gray-600 sm:basis-auto">CSV・画像はこの端末上で生成されます。</p>
    <p role="status" aria-live="polite" className="basis-full text-sm text-[#002255]">{message}</p>
    <div className="pointer-events-none absolute left-[-10000px] top-0" aria-hidden="true"><div ref={imageRef}><ExportImage presentation={presentation} date={now} /></div></div>
  </section>;
}
