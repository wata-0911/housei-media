import { useRef, useState } from 'react';
import artifact from '../../../generated/gradeImportBookmarklet.json';

export default function GradeImportBookmarklet({ disabled }: { disabled: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(artifact.bookmarklet);
      setStatus('コードをコピーしました。ブックマークのURL欄に貼り付けてください。');
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus('自動コピーできませんでした。選択されたコードを手動でコピーしてください。');
    }
  }
  return <details className="border bg-slate-50 p-3 text-sm">
    <summary className="cursor-pointer font-medium text-[#002255]">成績JSONの取得方法</summary>
    <div className="mt-3 space-y-3">
      <p>法政大学の成績ページから、この端末のクリップボードに成績JSONをコピーします。はじめに、Chromeで「成績コピー」用のブックマークを登録してください。</p>
      <p className="font-medium">ブックマークの登録（PC・スマートフォン共通）</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>下の「Bookmarkletのコードをコピー」を押します。</li>
        <li>Chromeでブックマークを作成し、ブックマークの編集画面を開きます。名前は「成績コピー」など、分かりやすいものにします。</li>
        <li>URL欄の元の内容をすべて削除し、コピーしたコードを貼り付けて保存します。元のURL（例：newtabなど）が残らないようにしてください。</li>
        <li>保存したブックマークを編集画面で確認し、URLの先頭が「javascript:」になっていることを確かめます。</li>
      </ol>
      <p className="font-medium">登録したブックマークの実行</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>PC Chrome：法政大学のWeb学習サービスにログインし、成績ページを表示した状態で、登録した「成績コピー」を実行します。</li>
        <li>iPhone Chrome：成績ページを表示したまま、アドレスバーに「成績コピー」など登録したブックマーク名を入力し、表示されたブックマーク候補を選択します。Googleの検索結果や「新しいタブで開く」を選ぶ操作とは異なります。</li>
      </ul>
      <p>コピーに成功すると、Plannerの成績取込画面を別タブで開くよう要求します。ポップアップ制限などで開かない場合は、手動でPlannerを開いて「成績データを取り込む」へ進んでください。ブラウザによっては、別タブへの移動後に元ページの通知を確認できないことがあります。</p>
      <p>成績JSONは自動貼り付け・自動保存されません。「成績JSONをここに貼り付け」に自分で貼り付け、「読み込み・検証」を押し、プレビュー（Preview）を確認してから明示的に保存してください。</p>
      <p className="text-xs text-slate-600">PC Chrome・iPhone Chromeで基本の流れを実機確認しています。Safariなど、今回未検証のブラウザでの動作は保証していません。</p>
      <button type="button" disabled={disabled} onClick={copyCode} className="planner-button border border-[#002255] bg-white px-3 py-2 text-[#002255] disabled:opacity-50">Bookmarkletのコードをコピー</button>
      <label className="block">手動コピー用コード
        <textarea ref={field} readOnly value={artifact.bookmarklet} onFocus={event => event.currentTarget.select()} className="mt-1 block h-20 w-full border bg-white p-2 font-mono text-xs" spellCheck={false} />
      </label>
      {status && <p role="status">{status}</p>}
      <p>URLの先頭が「javascript:」のまま保存されていることを確認してください。</p>
      <p className="text-xs text-slate-600">Bookmarkletはコピー成功後にPlannerの固定URLを別タブで開くよう要求します。成績の送信はせず、法政ID・認証Cookie・ページ全体のHTMLを取得しません。取り込み内容は下のプレビューで確認してから保存します。</p>
    </div>
  </details>;
}
