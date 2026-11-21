import { useState, type ReactNode } from 'react';
import type { Attempt, AttemptOwnedRecord } from '../../../planner/attempts/types';
import type { ProgressKind } from '../../../planner/attempts/production/acController';
import type { CourseGrade, ReportPassingGrade, ReportProgressStatus } from '../../../planner/plannerCatalog';

type Payload<K extends ProgressKind> = Extract<AttemptOwnedRecord, { kind: K }>['payload'];
const grades: CourseGrade[] = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
const passingGrades = grades.filter(grade => grade !== 'D');
const statuses: Record<ReportProgressStatus, string> = {
  not_submitted: '未提出', submitted: '提出済み', grading: '採点中', resubmit: '再提出', passed: '合格',
};

function grade(label: string, name: string, value: CourseGrade | null, report = false) {
  return <label>{label}<select name={name} defaultValue={value ?? ''}>
    <option value="">未記録</option>
    {(report ? passingGrades : grades).map(grade => <option key={grade}>{grade}</option>)}
  </select></label>;
}
function readCount(data: FormData, key: string, minimum: number, label: string) {
  const input = String(data.get(key) ?? '');
  if (input === '') return null;
  const value = Number(input);
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(label + 'は' + minimum + '以上の整数で入力してください。');
  }
  return value;
}
function status(name: string, value: ReportProgressStatus) {
  return <label>提出状況<select name={name} defaultValue={value}>
    {Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
  </select></label>;
}
function readReport(data: FormData, number: number, field: string) {
  const status = data.get(field + '-status') as ReportProgressStatus;
  const grade = (data.get(field + '-grade') || null) as ReportPassingGrade | null;
  if (grade && status !== 'passed') throw new Error('リポートの評価は合格の記録にのみ入力できます。');
  return { reportNumber: number, status, grade };
}
function readMedia(data: FormData, previous?: Payload<'media'>): Payload<'media'> {
  const totalLessons = readCount(data, 'total', 0, '全回数');
  const lessons = (previous?.lessons ?? []).map(({ lesson }) => ({
    lesson, videoCompleted: data.has('video-' + lesson), testCompleted: data.has('test-' + lesson),
  }));
  const added = readCount(data, 'new', 1, '追加する回');
  if (added === null && (data.has('new-video') || data.has('new-test'))) {
    throw new Error('動画・小テストを記録する回を入力してください。');
  }
  if (added !== null) {
    if (lessons.some(row => row.lesson === added)) throw new Error('同じ回が既にあります。');
    lessons.push({ lesson: added, videoCompleted: data.has('new-video'), testCompleted: data.has('new-test') });
  }
  if (totalLessons !== null && lessons.some(row => row.lesson > totalLessons)) {
    throw new Error('既存の回を保持するため、全回数を確認してください。');
  }
  return { totalLessons, lessons, assessments: previous?.assessments ?? [] };
}
function readCorrespondence(data: FormData, previous?: Payload<'correspondence'>): Payload<'correspondence'> {
  const requiredReports = readCount(data, 'reports', 0, '必要リポート数');
  const reports = (previous?.reports ?? []).map(row => readReport(data, row.reportNumber, String(row.reportNumber)));
  const added = readCount(data, 'new', 1, '追加する提出回');
  if (added === null && (data.get('new-status') !== 'not_submitted' || data.get('new-grade'))) {
    throw new Error('リポートを記録する提出回を入力してください。');
  }
  if (added !== null) {
    if (reports.some(row => row.reportNumber === added)) throw new Error('同じ提出回が既にあります。');
    reports.push(readReport(data, added, 'new'));
  }
  return { ...previous, requiredReports, reports, examGrade: (data.get('exam') || null) as CourseGrade | null };
}

type EditorProps = {
  attempt: Attempt;
  records: readonly AttemptOwnedRecord[];
  disabled: boolean;
  onUnsent: (kind: ProgressKind, value: boolean) => void;
  save: (kind: ProgressKind, payload: string) => boolean;
};

function DraftForm({ name, disabled, children, onUnsent, save, payload }: {
  name: string; disabled: boolean; children: ReactNode; onUnsent: (value: boolean) => void;
  save: (value: string) => boolean; payload: (data: FormData) => Payload<ProgressKind>;
}) {
  const [error, setError] = useState('');
  return <form aria-label={name} onChange={() => onUnsent(true)} onReset={() => { onUnsent(false); setError(''); }}
    onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      try {
        if (save(JSON.stringify(payload(new FormData(event.currentTarget))))) { onUnsent(false); setError(''); }
      } catch (error) { setError(error instanceof Error ? error.message : '入力を確認してください。'); }
    }}>
    <fieldset disabled={disabled}><legend>{name}</legend>{children}
      <button>進捗を下書きに反映</button>
      <button type="reset">この入力を取り消す</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function AttemptProgressEditor({ attempt, records, disabled, onUnsent, save }: EditorProps) {
  const method = attempt.method.value;
  const recordByKind = <K extends ProgressKind>(kind: K) =>
    records.filter((record): record is Extract<AttemptOwnedRecord, { kind: K }> => record.kind === kind);
  const media = recordByKind('media');
  const correspondence = recordByKind('correspondence');
  const evaluations = recordByKind('evaluation');
  const mediaPayload = media[0]?.payload;
  const correspondencePayload = correspondence[0]?.payload;
  const evaluation = evaluations[0]?.payload;
  const formProps = (kind: ProgressKind) => ({
    disabled, onUnsent: (value: boolean) => onUnsent(kind, value),
    save: (payload: string) => save(kind, payload),
  });
  return <>
    {method === 'media' && (media.length > 1 ? <p>メディア進捗の編集対象を確認するまで保留します。</p> :
      <DraftForm key={JSON.stringify(mediaPayload)} name={attempt.originalTitle + 'のメディア進捗'}
        {...formProps('media')} payload={data => readMedia(data, mediaPayload)}>
        <label>全回数（空欄は未確認）<input name="total" inputMode="numeric" defaultValue={mediaPayload?.totalLessons ?? ''} /></label>
        {mediaPayload?.lessons.map(row => <fieldset key={row.lesson}><legend>第{row.lesson}回</legend>
          <label><input type="checkbox" name={'video-' + row.lesson} defaultChecked={row.videoCompleted} />動画完了</label>
          <label><input type="checkbox" name={'test-' + row.lesson} defaultChecked={row.testCompleted} />小テスト完了</label>
        </fieldset>)}
        <label>追加する回<input name="new" inputMode="numeric" /></label>
        <label><input name="new-video" type="checkbox" />追加回の動画完了</label>
        <label><input name="new-test" type="checkbox" />追加回の小テスト完了</label>
        {mediaPayload?.assessments.length ? <p>日付付き評価 {mediaPayload.assessments.length}件は原文のまま保持します。</p> : null}
      </DraftForm>)}
    {method === 'correspondence' && (correspondence.length > 1 ? <p>通信進捗の編集対象を確認するまで保留します。</p> :
      <DraftForm key={JSON.stringify(correspondencePayload)} name={attempt.originalTitle + 'の通信進捗'}
        {...formProps('correspondence')} payload={data => readCorrespondence(data, correspondencePayload)}>
        <label>必要リポート数<input name="reports" inputMode="numeric" defaultValue={correspondencePayload?.requiredReports ?? ''} /></label>
        {correspondencePayload?.reports.map(row => <fieldset key={row.reportNumber}><legend>リポート {row.reportNumber}</legend>
          {status(row.reportNumber + '-status', row.status)}
          {grade('リポート評価', row.reportNumber + '-grade', row.grade, true)}
        </fieldset>)}
        <fieldset><legend>提出回を追加</legend><label>追加する提出回<input name="new" inputMode="numeric" /></label>
          {status('new-status', 'not_submitted')}{grade('リポート評価', 'new-grade', null, true)}
        </fieldset>
        {grade('単位修得試験（本人記録）', 'exam', correspondencePayload?.examGrade ?? null)}
      </DraftForm>)}
    {evaluations.length > 1 ? <p>本人評価の編集対象を確認するまで保留します。</p> :
      <DraftForm key={JSON.stringify(evaluation)} name={attempt.originalTitle + 'の本人評価'} {...formProps('evaluation')}
        payload={data => ({ finalGrade: (data.get('final') || null) as CourseGrade | null,
          reportGrade: (data.get('report') || null) as CourseGrade | null,
          schoolingGrade: (data.get('schooling') || null) as CourseGrade | null })}>
        {grade('最終評価（本人記録）', 'final', evaluation?.finalGrade ?? null)}
        {grade('リポート評価（本人記録）', 'report', evaluation?.reportGrade ?? null)}
        {grade('スクーリング評価（本人記録）', 'schooling', evaluation?.schoolingGrade ?? null)}
      </DraftForm>}
  </>;
}
