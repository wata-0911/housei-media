import type { PlannerAttemptView } from '../../planner/curriculumCourseView';

const reportLabels = { not_submitted: '未提出', submitted: '提出済み', grading: '添削中', resubmit: '再提出', passed: '合格済み' };
export default function SavedAttemptProgress({ progress }: { progress: PlannerAttemptView['progress'] }) {
  if (!progress.correspondence && !progress.mediaSchooling) return null;
  return <div className="mt-3 text-sm">
    <p>保存済み進捗（開講・方式の対応を確認してください）</p>
    {progress.correspondence && <div className="mt-2"><p>通信: 必要リポート {progress.correspondence.requiredReports ?? '未確認'}件 / 単位修得試験 {progress.correspondence.examGrade ?? '未受験'}</p><ul>{progress.correspondence.reports.map(report => <li key={report.reportNumber}>リポート {report.reportNumber}: {reportLabels[report.status]} / {report.grade ?? '未評価'}</li>)}</ul></div>}
    {progress.mediaSchooling && <div className="mt-2"><p>メディア: 全 {progress.mediaSchooling.totalLessons ?? '未確認'}回</p><ul>{progress.mediaSchooling.lessons.map(lesson => <li key={lesson.lesson}>第{lesson.lesson}回: 動画 {lesson.videoCompleted ? '完了' : '未完了'} / テスト {lesson.testCompleted ? '完了' : '未完了'}</li>)}</ul><ul>{progress.mediaSchooling.assessments.map(assessment => <li key={assessment.id}>{assessment.label || (assessment.type === 'midterm' ? '中間試験' : assessment.type === 'final' ? '期末試験' : 'その他')}: {assessment.scheduledDate ?? '日付未設定'} / {assessment.completed ? '完了' : '未完了'}</li>)}</ul></div>}
  </div>;
}
