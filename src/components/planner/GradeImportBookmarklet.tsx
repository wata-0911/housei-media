import { useRef, useState } from 'react';
import artifact from '../../generated/gradeImportBookmarklet.json';

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
      <p>成績ページから、この端末のクリップボードにJSONをコピーします。</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>下のコードをコピーし、ChromeからWeb学習サービスにログインして成績表を開き、新しくブックマークを登録して下さい。</li>
        <li>登録したブックマークのURL欄を開き、既存のURLを削除し、コピーしたコードを貼り付けて下さい。名前は「成績コピー」などにして下さい。</li>
        <li>登録したブックマークを実行し、成功の表示を確認し、この画面の「JSONを貼り付け」に貼り付けて「読み込み・検証」を押してください。</li>
      </ol>
      <button type="button" disabled={disabled} onClick={copyCode} className="border border-[#002255] bg-white px-3 py-2 text-[#002255] disabled:opacity-50">Bookmarkletのコードをコピー</button>
      <label className="block">手動コピー用コード
        <textarea ref={field} readOnly value={artifact.bookmarklet} onFocus={event => event.currentTarget.select()} className="mt-1 block h-20 w-full border bg-white p-2 font-mono text-xs" spellCheck={false} />
      </label>
      {status && <p role="status">{status}</p>}
      <p>URLの先頭が「javascript:」のまま保存されていることを確認してください。</p>
      <p className="text-xs text-slate-600">Bookmarkletは外部通信せず、法政ID・認証Cookie・ページ全体のHTMLを取得しません。取り込み内容は下のプレビューで確認してから保存します。</p>
    </div>
  </details>;
}
