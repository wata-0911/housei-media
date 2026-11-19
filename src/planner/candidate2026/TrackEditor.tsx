import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Track } from './atomic-media.mjs';

type Fields = {
  video: boolean;
  test: boolean;
  assessment: string;
  date: string;
  completed: boolean;
};

export function TrackEditor({ track, disabled, markDirty, save, noticeRevision }: {
  track: Track;
  disabled: boolean;
  markDirty: (id: string, dirty: boolean) => void;
  save: (track: Track, matchesDraft: () => boolean) => Promise<boolean>;
  noticeRevision: number | null;
}) {
  const [selection, setSelection] = useState(1);
  const [draft, setDraft] = useState<Fields | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const revision = useRef(0);
  const selected = Math.min(selection, track.totalLessons);
  const savedLesson = track.lessons.find(value => value.lesson === selected);
  const first = track.assessments[0];
  const fields = draft ?? {
    video: savedLesson?.videoCompleted ?? false,
    test: savedLesson?.testCompleted ?? false,
    assessment: first?.label ?? '',
    date: first?.scheduledDate ?? '',
    completed: first?.completed ?? false,
  };

  function edit(change: Partial<Fields>) {
    revision.current++;
    setSavedRevision(null);
    setDraft({ ...fields, ...change });
    markDirty(track.id, true);
  }

  function discard() {
    revision.current++;
    setSavedRevision(null);
    setDraft(null);
    markDirty(track.id, false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const progress = { lesson: selected, videoCompleted: fields.video, testCompleted: fields.test };
    const label = fields.assessment.trim();
    const date = fields.date || null;
    if (!label && (date || fields.completed)) {
      event.currentTarget.querySelector<HTMLInputElement>('[name=assessment]')?.focus();
      return;
    }
    const submitted = revision.current;
    const matchesDraft = () => revision.current === submitted;
    setSavedRevision(null);
    const committed = await save({
      ...track,
      lessons: [...track.lessons.filter(value => value.lesson !== selected), progress].sort((a, b) => a.lesson - b.lesson),
      assessments: label ? [
        { id: first?.id ?? crypto.randomUUID(), label, scheduledDate: date, completed: fields.completed },
        ...track.assessments.slice(1),
      ] : track.assessments.slice(1),
    }, matchesDraft);
    if (!committed || !matchesDraft()) return;
    discard();
    setSavedRevision(noticeRevision);
  }

  return <section aria-label="本人メディア進捗">
    <h3>独立した本人履修回</h3>
    <p>本人記録ID <code data-testid="track-id">{track.id}</code></p>
    <p data-testid="progress">動画 {track.lessons.filter(item => item.videoCompleted).length}/{track.totalLessons} ／ 小テスト {track.lessons.filter(item => item.testCompleted).length}/{track.totalLessons}</p>
    <label>編集する回 <select value={selected} onChange={event => { setSelection(Number(event.target.value)); setSavedRevision(null); }} disabled={disabled || draft !== null}>
      {Array.from({ length: track.totalLessons }, (_, index) => <option key={index + 1} value={index + 1}>第{index + 1}回</option>)}
    </select></label>
    <form onSubmit={submit} onReset={event => { event.preventDefault(); discard(); }}>
      <fieldset disabled={disabled}>
        <legend>本人の進捗と予定</legend>
        <label><input name="video" type="checkbox" checked={fields.video} onChange={event => edit({ video: event.target.checked })} /> 動画を視聴した</label>
        <label><input name="test" type="checkbox" checked={fields.test} onChange={event => edit({ test: event.target.checked })} /> 小テストを完了した</label>
        <label>評価予定の名称 <input name="assessment" value={fields.assessment} onChange={event => edit({ assessment: event.target.value })} maxLength={200} /></label>
        <label>評価予定日 <input name="date" type="date" value={fields.date} onChange={event => edit({ date: event.target.value })} /></label>
        <label><input name="completed" type="checkbox" checked={fields.completed} onChange={event => edit({ completed: event.target.checked })} /> 評価を完了した</label>
        <button type="submit">本人メディア進捗を保存</button>
        {draft && <button type="reset">今回の未保存の入力を戻す</button>}
      </fieldset>
    </form>
    {noticeRevision !== null && savedRevision === noticeRevision && <p role="status">本人メディア進捗を保存しました。</p>}
  </section>;
}
