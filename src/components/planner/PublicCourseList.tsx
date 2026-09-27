import { useState, type FormEvent } from 'react';
import type { PublicCourse } from '../../planner/plannerCatalog';

const statuses: Record<PublicCourse['status'], string> = {
  planned: '計画中', in_progress: '履修中', waiting: '結果待ち', earned: '修得済み', failed: '不合格', dropped: '取りやめ',
};
const control = 'w-full min-w-0 border border-gray-300 rounded-sm p-2 bg-white disabled:opacity-50';
type Props = {
  courses: PublicCourse[];
  disabled: boolean;
  onAdd: (title: string) => void;
  onChange: (id: string, patch: Partial<Omit<PublicCourse, 'id' | 'credits'>>) => void;
  onRemove: (id: string) => void;
};

function YearEditor({ course, disabled, onChange }: { course: PublicCourse; disabled: boolean; onChange: Props['onChange'] }) {
  const [draft, setDraft] = useState(course.plannedYear?.toString() ?? '');
  const [error, setError] = useState('');
  return <form onSubmit={event => {
    event.preventDefault();
    const year = draft.trim() === '' ? null : Number(draft);
    if (year !== null && (!/^\d{4}$/.test(draft) || year < 1900 || year > 9999)) { setError('年度は1900〜9999の整数で入力してください。'); return; }
    setError(''); onChange(course.id, { plannedYear: year });
  }}>
    <label htmlFor={`public-year-${course.id}`} className="block text-sm mb-1">計画年度</label>
    <div className="flex gap-2"><input id={`public-year-${course.id}`} inputMode="numeric" value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} placeholder="未設定" className={control} />
      <button type="submit" disabled={disabled} className="shrink-0 border border-[#002255] px-2 text-sm disabled:opacity-50">保存</button></div>
    {error && <p role="alert" className="text-sm text-red-700 mt-1">{error}</p>}
  </form>;
}

export default function PublicCourseList({ courses, disabled, onAdd, onChange, onRemove }: Props) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    const normalized = title.trim();
    if (!normalized) { setError('実際の科目名を入力してください。'); return; }
    if (normalized.length > 200) { setError('科目名は200文字以内で入力してください。'); return; }
    setError(''); setTitle(''); onAdd(normalized);
  };
  return <section aria-labelledby="public-course-heading" className="bg-white border border-gray-200 p-5 sm:p-7 min-w-0">
    <h2 id="public-course-heading" className="text-xl text-[#002255]">他学部・他学科の公開科目を記録</h2>
    <p className="text-sm text-gray-600 mt-3">公開科目は1件2単位として記録します。所属学部・学科の通常科目は通常の科目検索から追加してください。</p>
    <p className="text-xs leading-relaxed text-amber-800 bg-amber-50 p-3 mt-3">同じ実開講を通常のcatalog科目と公開科目の両方に登録すると二重記録になります。どちらか一方だけを追加してください。</p>
    <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
      <div><label htmlFor="public-course-title" className="block text-sm mb-1">実際の科目名（例：法律学特講［○○］）</label>
        <input id="public-course-title" value={title} maxLength={200} disabled={disabled} onChange={event => setTitle(event.target.value)} className={control} /></div>
      <button type="submit" disabled={disabled} className="border border-[#002255] px-4 py-2 text-sm disabled:opacity-50">公開科目を追加（2単位）</button>
      {error && <p role="alert" className="sm:col-span-2 text-sm text-red-700">{error}</p>}
    </form>
    {courses.length === 0 && <p className="text-sm text-gray-600 mt-5">公開科目はまだ追加されていません。</p>}
    <ul className="divide-y divide-gray-100 mt-4">
      {courses.map(course => <li key={course.id} className="py-4 min-w-0">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium break-words">{course.title}</p><p className="mt-1 text-xs text-[#002255]">公開科目 / 2単位</p></div>
          <button type="button" onClick={() => onRemove(course.id)} disabled={disabled} aria-label={`${course.title}を公開科目から削除`} title={`${course.title}を公開科目から削除`} className="shrink-0 rounded-sm p-2 text-red-700 hover:bg-red-50 disabled:opacity-50">🗑</button></div>
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <div><label htmlFor={`public-title-${course.id}`} className="block text-sm mb-1">科目名</label><input id={`public-title-${course.id}`} value={course.title} maxLength={200} disabled={disabled} onChange={event => onChange(course.id, { title: event.target.value })} onBlur={event => onChange(course.id, { title: event.target.value.trim() })} className={control} /></div>
          <YearEditor key={`${course.id}-${course.plannedYear}`} course={course} disabled={disabled} onChange={onChange} />
          <div><label htmlFor={`public-term-${course.id}`} className="block text-sm mb-1">計画期</label><input id={`public-term-${course.id}`} value={course.plannedTerm ?? ''} disabled={disabled} placeholder="未設定" onChange={event => onChange(course.id, { plannedTerm: event.target.value || null })} className={control} /></div>
          <div><label htmlFor={`public-status-${course.id}`} className="block text-sm mb-1">履修状態</label><select id={`public-status-${course.id}`} value={course.status} disabled={disabled} onChange={event => onChange(course.id, { status: event.target.value as PublicCourse['status'] })} className={control}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        </div>
      </li>)}
    </ul>
  </section>;
}
