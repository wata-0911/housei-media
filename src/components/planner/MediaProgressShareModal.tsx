import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { assessmentDateLabel, assessmentLabel, mediaShareIntentUrl, mediaSharePost } from '../../planner/mediaSchooling';
import type { MediaShareGroup, MediaShareTemplate } from '../../planner/mediaSchooling';

type Props = { groups: MediaShareGroup[]; onClose: () => void };

function download(dataUrl: string) {
  const link = document.createElement('a');
  link.download = 'メディアスクーリング進捗.png';
  link.href = dataUrl;
  link.click();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
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

function ProgressGroups({ groups, template }: { groups: MediaShareGroup[]; template: MediaShareTemplate }) {
  return <div className="space-y-6">{groups.map(group => <section key={group.deliveryCategory} className="border-t border-[#dfd4c5] pt-4 first:border-t-0 first:pt-0">
    <h4 className="font-semibold text-[#002255]">{group.deliveryCategory}進捗</h4>
    <ul className="mt-2 space-y-2">{group.courses.map((course, index) => <li key={`${course.name}-${index}`} className="bg-white px-3 py-2.5 text-sm">
      <span className="block max-w-full break-words leading-snug [line-break:strict]">{course.name}</span>
      <span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 tabular-nums sm:justify-end">
        {course.totalLessons === null
          ? <><span className="whitespace-nowrap">動画 {course.videoCompletedCount}回</span><span className="whitespace-nowrap">テスト {course.testCompletedCount}回（全回数未設定）</span></>
          : <><span className="whitespace-nowrap">動画 {course.videoCompletedCount}/{course.totalLessons}{course.videoDone ? ' ✅' : ''}</span><span className="whitespace-nowrap">テスト {course.testCompletedCount}/{course.totalLessons}{course.testDone ? ' ✅' : ''}</span></>}
      </span>{template === 'progress_with_assessments' && course.assessments.length > 0 && <ul className="mt-2 space-y-1 border-t border-[#eee5d9] pt-2 text-xs leading-relaxed text-[#38465d]">{course.assessments.map(assessment => <li key={assessment.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 break-words"><span>{assessmentLabel(assessment)} <span className="whitespace-nowrap">{assessmentDateLabel(assessment)}</span></span><span className="whitespace-nowrap">{assessment.completed ? '実施済み ✅' : '未実施'}</span></li>)}</ul>}
    </li>)}</ul>
    <div className="mt-2 text-right text-sm font-semibold tabular-nums">{group.totalLessons === null ? <p>全回数未設定の科目あり</p> : <><p>動画トータル  {group.totalVideoCompleted}/{group.totalLessons}</p><p>テストトータル  {group.totalTestCompleted}/{group.totalLessons}</p></>}</div>
  </section>)}</div>;
}

export default function MediaProgressShareModal({ groups, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState('');
  const [template, setTemplate] = useState<MediaShareTemplate>('progress');
  const [isDownloading, setIsDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const post = mediaSharePost(groups, comment, template);
  const date = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

  async function handleDownload() {
    if (!cardRef.current) return;
    setIsDownloading(true); setMessage('画像を準備しています…');
    try {
      const dataUrl = await toPng(cardRef.current, { backgroundColor: '#fffaf3', pixelRatio: 2, cacheBust: true, skipFonts: true });
      download(dataUrl); setMessage('画像をダウンロードしました。');
    } catch { setMessage('画像を作成できませんでした。もう一度お試しください。'); } finally { setIsDownloading(false); }
  }
  async function handleCopy() {
    try { await copyText(post); setMessage('投稿文をコピーしました。'); } catch { setMessage('コピーできませんでした。投稿文を選択してコピーしてください。'); }
  }
  function handleXPost() {
    const popup = window.open(mediaShareIntentUrl(post), '_blank', 'noopener,noreferrer');
    if (popup) popup.opener = null;
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-6" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="media-share-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-sm">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 sm:px-6"><div><h2 id="media-share-title" className="text-lg font-medium text-[#002255]">メディア進捗を共有</h2><p className="mt-1 text-sm text-gray-600">年間履修計画にあるメディア科目をまとめて共有します。</p></div><button type="button" onClick={onClose} className="shrink-0 border border-gray-300 px-3 py-2 text-sm" aria-label="共有モーダルを閉じる">閉じる</button></div>
      <div className="space-y-6 p-4 sm:p-6">
        <div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-[#002255]">画像プレビュー</h3><button type="button" onClick={handleDownload} disabled={isDownloading} className="border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white disabled:opacity-50">{isDownloading ? '画像を作成中…' : '画像をダウンロード'}</button></div>
          <fieldset className="mb-4"><legend className="text-sm text-gray-700">共有テンプレ</legend><div className="mt-2 flex flex-wrap gap-2"><label className={`cursor-pointer border px-3 py-2 text-sm ${template === 'progress' ? 'border-[#002255] bg-[#eef4fb]' : 'border-gray-300'}`}><input className="mr-1.5" type="radio" name="media-share-template" checked={template === 'progress'} onChange={() => setTemplate('progress')} />進捗のみ</label><label className={`cursor-pointer border px-3 py-2 text-sm ${template === 'progress_with_assessments' ? 'border-[#002255] bg-[#eef4fb]' : 'border-gray-300'}`}><input className="mr-1.5" type="radio" name="media-share-template" checked={template === 'progress_with_assessments'} onChange={() => setTemplate('progress_with_assessments')} />進捗＋試験</label></div></fieldset>
          <label className="mb-3 block text-sm text-gray-700">ひとこと（任意）<textarea value={comment} maxLength={280} rows={2} onChange={event => setComment(event.target.value)} placeholder="例: 少しずつ進めています" className="mt-1 w-full resize-y border border-gray-300 p-2" /></label>
          <div className="overflow-hidden border border-[#d6c6af] bg-[#fffaf3]"><div ref={cardRef} className="bg-[#fffaf3] p-5 text-left text-[#18243b] sm:p-7"><p className="text-xs font-semibold tracking-[0.16em] text-[#a34700]">HOSEI TSUSHIN</p><h3 className="mt-2 text-xl font-semibold tracking-wide text-[#002255]">メディアスクーリング進捗</h3><div className="mt-5"><ProgressGroups groups={groups} template={template} /></div>{comment.trim() && <p className="mt-5 whitespace-pre-wrap border-t border-[#dfd4c5] pt-3 text-sm leading-relaxed">{comment.trim()}</p>}<p className="mt-5 text-right text-xs text-gray-500">{date}</p></div></div>
        </div>
        <div className="border-t border-gray-200 pt-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-[#002255]">投稿文プレビュー</h3><div className="flex flex-wrap gap-2"><button type="button" onClick={handleXPost} className="border border-[#002255] bg-[#002255] px-3 py-2 text-sm text-white">Xに投稿</button><button type="button" onClick={handleCopy} className="border border-[#002255] px-3 py-2 text-sm">投稿文をコピー</button></div></div><pre className="whitespace-pre-wrap break-words bg-gray-50 p-4 text-sm leading-relaxed text-gray-800">{post}</pre>{post.length > 280 && <p className="mt-2 text-sm text-amber-800">Xの文字数目安（280文字）を超えています。本文は省略していません。</p>}</div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-[#002255]">{message}</p>
      </div>
    </section>
  </div>;
}
