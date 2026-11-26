import { useState } from 'react';
import { plannerExportCsv, plannerExportFileName, type PlannerExportPresentation } from '../../../planner/exports/plannerExport';

type Props = { presentation: PlannerExportPresentation };

function downloadBlob(contents: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PlannerExportActions({ presentation }: Props) {
  const [message, setMessage] = useState('');

  function handleCsv() {
    downloadBlob(
      plannerExportCsv(presentation),
      `${plannerExportFileName(new Date())}.csv`,
      'text/csv;charset=utf-8'
    );
    setMessage('CSVを保存しました。');
  }

  return (
    <section
      aria-label="履修計画の保存"
      className="flex flex-wrap items-center gap-2 border border-gray-200 bg-white p-4 sm:p-5"
    >
      <button
        type="button"
        onClick={handleCsv}
        className="planner-button border border-[#002255] px-3 py-2 text-sm text-[#002255]"
      >
        CSVで保存
      </button>

      <p className="basis-full text-xs text-gray-600 sm:basis-auto">
        CSVはこの端末上で生成されます。
      </p>
      <p role="status" aria-live="polite" className="basis-full text-sm text-[#002255]">
        {message}
      </p>
    </section>
  );
}
