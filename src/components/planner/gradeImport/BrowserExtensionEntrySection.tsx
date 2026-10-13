export const PLANNER_EXTENSION_PUBLIC_URL: string | null = null;

type Props = {
  publicUrl?: string | null;
};

export default function BrowserExtensionEntrySection({ publicUrl = PLANNER_EXTENSION_PUBLIC_URL }: Props) {
  return <section aria-labelledby="planner-extension-heading" className="border border-[#002255] bg-white p-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-3xl">
        <h2 id="planner-extension-heading" className="text-lg text-[#002255]">ブラウザ拡張機能で成績を取り込む</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">専用のブラウザ拡張機能を使って、法政大学側の成績情報を履修プランナーへ取り込めます。取り込み後の科目対応はPlanner上で確認してください。</p>
        {!publicUrl && <p id="planner-extension-status" className="mt-2 text-sm font-medium text-[#9A3D00]">拡張機能は現在公開準備中です。</p>}
      </div>
      {publicUrl
        ? <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 shrink-0 items-center justify-center bg-[#002255] px-4 py-2 text-center text-sm text-white underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002255]">拡張機能を入手<span className="sr-only">（外部サイトを新しいタブで開きます）</span></a>
        : <button type="button" disabled aria-describedby="planner-extension-status" className="min-h-10 shrink-0 cursor-not-allowed border border-gray-300 bg-gray-100 px-4 py-2 text-sm text-gray-500 disabled:opacity-100">拡張機能を入手（公開準備中）</button>}
    </div>
  </section>;
}
