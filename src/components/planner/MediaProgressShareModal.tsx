import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { completedMediaLessons, mediaProgressSummary, mediaSharePost } from '../../planner/mediaSchooling';
import type { MediaCourseProgress, Offering } from '../../planner/plannerCatalog';

type Props = {
  offering: Offering;
  progress: MediaCourseProgress;
  onClose: () => void;
};

function download(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

export default function MediaProgressShareModal({ offering, progress, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const summary = mediaProgressSummary(progress);
  const post = mediaSharePost(offering.name, offering.deliveryCategory, progress);
  const totalLabel = progress.totalLessons === null ? '未設定' : `${progress.totalLessons}回`;
  const date = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

  async function handleDownload() {
    if (!cardRef.current) return;
    setIsDownloading(true);
    setMessage('画像を準備しています…');
    try {
      // The app uses a remote display font. Keep exports fully local so a slow or blocked font request never delays a download.
      const dataUrl = await toPng(cardRef.current, { backgroundColor: '#fffaf3', pixelRatio: 2, cacheBust: true, skipFonts: true });
      const safeName = offering.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'media-progress';
      download(dataUrl, `${safeName}-メディアスクーリング進捗.png`);
      setMessage('画像をダウンロードしました。');
    } catch {
      setMessage('画像を作成できませんでした。もう一度お試しください。');
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleCopy() {
    try {
      await copyText(post);
      setMessage('投稿文をコピーしました。');
    } catch {
      setMessage('コピーできませんでした。投稿文を選択してコピーしてください。');
    }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-6" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="media-share-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-sm">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 sm:px-6">
        <div><h2 id="media-share-title" className="text-lg font-medium text-[#002255]">投稿用にまとめる</h2><p className="mt-1 text-sm text-gray-600">共有用の見やすい画像と投稿文を作成します。</p></div>
        <button type="button" onClick={onClose} className="shrink-0 border border-gray-300 px-3 py-2 text-sm" aria-label="共有モーダルを閉じる">閉じる</button>
      </div>
      <div className="space-y-6 p-4 sm:p-6">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-[#002255]">画像プレビュー</h3><button type="button" onClick={handleDownload} disabled={isDownloading} className="border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">{isDownloading ? '画像を作成中…' : '画像をダウンロード'}</button></div>
          <label className="mb-3 block text-sm text-gray-700">ひとこと（任意）
            <input value={comment} maxLength={80} onChange={event => setComment(event.target.value)} placeholder="例: 少しずつ進めています" className="mt-1 w-full border border-gray-300 p-2" />
          </label>
          <div className="overflow-hidden border border-[#d6c6af] bg-[#fffaf3]">
            <div ref={cardRef} className="bg-[#fffaf3] p-5 text-left text-[#18243b] sm:p-7">
              <p className="text-xs font-semibold tracking-[0.16em] text-[#a34700]">HOSEI TSUSHIN</p>
              <h3 className="mt-2 text-xl font-semibold tracking-wide text-[#002255]">メディアスクーリング進捗</h3>
              <div className="mt-5 border-l-4 border-[#e65c00] pl-3"><p className="text-lg font-medium break-words">{offering.name}</p><p className="mt-1 text-sm text-gray-600">{offering.deliveryCategory ?? 'メディアスクーリング'} ・ 全{totalLabel}</p></div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="bg-white p-3"><p className="text-xs text-gray-600">動画完了</p><p className="mt-1 text-xl font-semibold text-[#002255]">{summary.video}</p></div>
                <div className="bg-white p-3"><p className="text-xs text-gray-600">テスト完了</p><p className="mt-1 text-xl font-semibold text-[#002255]">{summary.test}</p></div>
                <div className="bg-white p-3"><p className="text-xs text-gray-600">総合進捗</p><p className="mt-1 text-xl font-semibold text-[#e65c00]">{summary.percent === null ? '—' : `${summary.percent}%`}</p></div>
              </div>
              <div className="mt-5"><div className="flex justify-between text-sm"><span>完了回数 {progress.totalLessons === null ? '—' : `${completedMediaLessons(progress)}/${progress.totalLessons}`}</span><span>{summary.percent === null ? '全回数を設定してください' : `${summary.percent}%`}</span></div><div className="mt-2 h-2 bg-[#eadfce]"><div className="h-full bg-[#e65c00]" style={{ width: `${summary.percent ?? 0}%` }} /></div></div>
              {progress.totalLessons !== null && <div className="mt-5 border-t border-[#dfd4c5] pt-3"><p className="text-sm font-medium">回ごとの進捗</p><div className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">{Array.from({ length: progress.totalLessons }, (_, index) => index + 1).map(lesson => { const entry = progress.lessons.find(current => current.lesson === lesson); return <div key={lesson} className="flex justify-between bg-white px-2 py-1.5"><span>第{lesson}回</span><span>動画 {entry?.videoCompleted ? '✓' : '—'} ・ テスト {entry?.testCompleted ? '✓' : '—'}</span></div>; })}</div></div>}
              {comment.trim() && <p className="mt-5 border-t border-[#dfd4c5] pt-3 text-sm leading-relaxed">「{comment.trim()}」</p>}
              <p className="mt-5 text-right text-xs text-gray-500">{date}</p>
            </div>
          </div>
        </div>
        <div className="border-t border-gray-200 pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-[#002255]">投稿文プレビュー</h3><button type="button" onClick={handleCopy} className="border border-[#002255] px-3 py-2 text-sm">投稿文をコピー</button></div>
          <pre className="whitespace-pre-wrap break-words bg-gray-50 p-4 text-sm leading-relaxed text-gray-800">{post}</pre>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-[#002255]">{message}</p>
      </div>
    </section>
  </div>;
}
