import type { MediaAssessment, MediaCourseProgress, MediaLessonProgress, Offering, PlannerItem } from '../plannerCatalog';

type ProgressBody = Omit<MediaCourseProgress, 'offeringId'>;

/** The 2026 snapshot labels media offerings structurally with these delivery categories. */
const MEDIA_DELIVERY_CATEGORIES = new Set(['前期メディア', '後期メディア']);

export function isMediaSchooling(offering: Offering | undefined): boolean {
  return offering?.method === 'schooling' && offering.deliveryCategory !== null && MEDIA_DELIVERY_CATEGORIES.has(offering.deliveryCategory);
}

export function mediaPlanItems(items: PlannerItem[], offerings: Map<string, Offering>): PlannerItem[] {
  return items.filter(item => isMediaSchooling(offerings.get(item.offeringId)));
}

export function progressFor(offeringId: string, progress: Record<string, MediaCourseProgress>): MediaCourseProgress {
  const saved = progress[offeringId];
  return saved ? { ...saved, assessments: saved.assessments ?? [] } : { offeringId, totalLessons: null, lessons: [], assessments: [] };
}

export function setTotalLessons<T extends ProgressBody>(course: T, totalLessons: number | null): T | null {
  if (totalLessons !== null && (!Number.isInteger(totalLessons) || totalLessons < 1 || totalLessons > 200)) return null;
  if (totalLessons !== null && course.lessons.some(lesson => lesson.lesson > totalLessons && (lesson.videoCompleted || lesson.testCompleted))) return null;
  return { ...course, totalLessons, lessons: course.lessons.filter(lesson => totalLessons === null || lesson.lesson <= totalLessons) };
}

export function toggleLesson<T extends ProgressBody>(course: T, lesson: number, field: 'videoCompleted' | 'testCompleted'): T {
  const current = course.lessons.find(entry => entry.lesson === lesson);
  const next: MediaLessonProgress = { lesson, videoCompleted: current?.videoCompleted ?? false, testCompleted: current?.testCompleted ?? false, [field]: !(current?.[field] ?? false) };
  const lessons = [...course.lessons.filter(entry => entry.lesson !== lesson), next]
    .filter(entry => entry.videoCompleted || entry.testCompleted)
    .sort((a, b) => a.lesson - b.lesson);
  return { ...course, lessons };
}

/** Marks videos through the selected lesson as complete without changing tests or assessments. */
export function completeVideosThroughLesson<T extends ProgressBody>(course: T, throughLesson: number): T | null {
  if (course.totalLessons === null || !Number.isInteger(course.totalLessons) || course.totalLessons < 1 || !Number.isInteger(throughLesson) || throughLesson < 1 || throughLesson > course.totalLessons) return null;
  const lessonsByNumber = new Map<number, MediaLessonProgress>();
  for (const lesson of course.lessons) {
    const current = lessonsByNumber.get(lesson.lesson);
    lessonsByNumber.set(lesson.lesson, current
      ? { ...lesson, videoCompleted: current.videoCompleted || lesson.videoCompleted, testCompleted: current.testCompleted || lesson.testCompleted }
      : lesson);
  }
  for (let lesson = 1; lesson <= throughLesson; lesson += 1) {
    const current = lessonsByNumber.get(lesson);
    lessonsByNumber.set(lesson, { lesson, videoCompleted: true, testCompleted: current?.testCompleted ?? false });
  }
  return { ...course, lessons: [...lessonsByNumber.values()].sort((a, b) => a.lesson - b.lesson) };
}

export function assessmentLabel(assessment: MediaAssessment): string {
  if (assessment.type === 'midterm') return '中間試験';
  if (assessment.type === 'final') return '期末試験';
  return assessment.label;
}

export function assessmentDateLabel(assessment: MediaAssessment): string {
  return assessment.scheduledDate === null ? '日程未設定' : assessment.scheduledDate.replaceAll('-', '/');
}

export function updateAssessment<T extends ProgressBody>(course: T, id: string, patch: Partial<Omit<MediaAssessment, 'id'>>): T {
  return { ...course, assessments: (course.assessments ?? []).map(assessment => assessment.id === id ? { ...assessment, ...patch } : assessment) };
}

export function removeAssessment<T extends ProgressBody>(course: T, id: string): T {
  return { ...course, assessments: (course.assessments ?? []).filter(assessment => assessment.id !== id) };
}

export function addAssessment<T extends ProgressBody>(course: T, assessment: MediaAssessment): T {
  return { ...course, assessments: [...(course.assessments ?? []), assessment] };
}

export function mediaProgressSummary(course: ProgressBody): { video: number; test: number; percent: number | null } {
  const video = course.lessons.filter(lesson => lesson.videoCompleted).length;
  const test = course.lessons.filter(lesson => lesson.testCompleted).length;
  return { video, test, percent: course.totalLessons === null ? null : Math.round(((video + test) / (course.totalLessons * 2)) * 100) };
}

export function completedMediaLessons(course: MediaCourseProgress): number {
  return course.lessons.filter(lesson => lesson.videoCompleted && lesson.testCompleted).length;
}

export type MediaShareTemplate = 'progress' | 'progress_with_assessments';
export type MediaShareCourse = { name: string; videoCompletedCount: number; testCompletedCount: number; totalLessons: number | null; videoDone: boolean; testDone: boolean; assessments: MediaAssessment[] };
type MediaShareCategory = '前期メディア' | '後期メディア' | '履修期未設定';
export type MediaShareGroup = { deliveryCategory: MediaShareCategory; courses: MediaShareCourse[]; totalVideoCompleted: number; totalTestCompleted: number; totalLessons: number | null; unconfiguredCourses: number };
export type MediaShareAssessmentLine = { label: string; date: string; completed: boolean };
export type MediaSharePresentationCourse = Omit<MediaShareCourse, 'assessments'> & { assessmentLines: MediaShareAssessmentLine[] };
export type MediaSharePresentationGroup = Omit<MediaShareGroup, 'courses'> & { courses: MediaSharePresentationCourse[] };
/** A current Media course whose lifecycle is managed outside PlannerItem. */
export type ImportedMediaShareItem = { offering: Offering; name: string };
type IndependentMediaShareItem = { name: string; deliveryCategory: MediaShareCategory; progress: ProgressBody };

export function mediaShareViewModel(items: PlannerItem[], offerings: Map<string, Offering>, progress: Record<string, MediaCourseProgress>,
  importedItems: ImportedMediaShareItem[] = [], independentItems: IndependentMediaShareItem[] = []): MediaShareGroup[] {
  const groups = new Map<MediaShareCategory, MediaShareGroup>();
  const offeringItems = [
    ...mediaPlanItems(items, offerings).map(item => ({ offering: offerings.get(item.offeringId)!, name: offerings.get(item.offeringId)!.name })),
    ...importedItems,
  ];
  const seenOfferings = new Set<string>();
  const courses = offeringItems.flatMap(({ offering, name }) => {
    // A concrete plan takes precedence over the same legacy Offering.
    if (seenOfferings.has(offering.id)) return [];
    seenOfferings.add(offering.id);
    return [{ name, deliveryCategory: offering.deliveryCategory as MediaShareCategory, progress: progressFor(offering.id, progress) }];
  });
  for (const { name, deliveryCategory, progress: course } of [...courses, ...independentItems]) {
    const { video: videoCompletedCount, test: testCompletedCount } = mediaProgressSummary(course);
    const row: MediaShareCourse = { name, videoCompletedCount, testCompletedCount, totalLessons: course.totalLessons, videoDone: course.totalLessons !== null && videoCompletedCount === course.totalLessons, testDone: course.totalLessons !== null && testCompletedCount === course.totalLessons, assessments: course.assessments ?? [] };
    const group = groups.get(deliveryCategory) ?? { deliveryCategory, courses: [], totalVideoCompleted: 0, totalTestCompleted: 0, totalLessons: 0, unconfiguredCourses: 0 };
    group.courses.push(row);
    group.totalVideoCompleted += videoCompletedCount;
    group.totalTestCompleted += testCompletedCount;
    if (course.totalLessons === null) group.unconfiguredCourses += 1;
    else group.totalLessons = (group.totalLessons ?? 0) + course.totalLessons;
    groups.set(deliveryCategory, group);
  }
  const categoryOrder: MediaShareCategory[] = ['前期メディア', '後期メディア', '履修期未設定'];
  return categoryOrder.flatMap(category => {
    const group = groups.get(category);
    return group ? [{ ...group, totalLessons: group.unconfiguredCourses === 0 ? group.totalLessons : null }] : [];
  });
}

/**
 * The text post and PNG deliberately consume this same model. Template A returns
 * no assessment lines, preserving its established output and visual layout.
 */
export function mediaSharePresentation(groups: MediaShareGroup[], template: MediaShareTemplate): MediaSharePresentationGroup[] {
  return groups.map(group => ({
    ...group,
    courses: group.courses.map(course => ({
      name: course.name,
      videoCompletedCount: course.videoCompletedCount,
      testCompletedCount: course.testCompletedCount,
      totalLessons: course.totalLessons,
      videoDone: course.videoDone,
      testDone: course.testDone,
      assessmentLines: template === 'progress_with_assessments'
        ? course.assessments.map(assessment => ({ label: assessmentLabel(assessment), date: assessmentDateLabel(assessment), completed: assessment.completed }))
        : [],
    })),
  }));
}

export function mediaSharePost(groups: MediaShareGroup[], comment = '', template: MediaShareTemplate = 'progress'): string {
  const presentation = mediaSharePresentation(groups, template);
  const lines = presentation.flatMap((group, index) => [
    ...(index === 0 ? [] : ['']), `${group.deliveryCategory}進捗`,
    ...group.courses.flatMap(course => [
      `・${course.name}`,
      course.totalLessons === null
        ? `動画 ${course.videoCompletedCount}回・テスト ${course.testCompletedCount}回（全回数未設定）`
        : `動画 ${course.videoCompletedCount}/${course.totalLessons}${course.videoDone ? ' ✅' : ''}・テスト ${course.testCompletedCount}/${course.totalLessons}${course.testDone ? ' ✅' : ''}`,
      ...course.assessmentLines.map(
        assessment =>
          `  ${assessment.label}  ${assessment.date}  ${assessment.completed ? '実施済み ✅' : '未実施'}`
      ),
    ]),
    ...(group.totalLessons === null ? ['全回数未設定の科目あり'] : [`動画トータル  ${group.totalVideoCompleted}/${group.totalLessons}`, `テストトータル  ${group.totalTestCompleted}/${group.totalLessons}`]),
  ]);
  return [...lines, ...(comment.trim() ? ['', comment.trim()] : [])].join('\n');
}

export function mediaShareIntentUrl(post: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(post)}`;
}
