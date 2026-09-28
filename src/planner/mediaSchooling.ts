import type { MediaCourseProgress, MediaLessonProgress, Offering, PlannerItem } from './plannerCatalog';

/** The 2026 snapshot labels media offerings structurally with these delivery categories. */
const MEDIA_DELIVERY_CATEGORIES = new Set(['前期メディア', '後期メディア']);

export function isMediaSchooling(offering: Offering | undefined): boolean {
  return offering?.method === 'schooling' && offering.deliveryCategory !== null && MEDIA_DELIVERY_CATEGORIES.has(offering.deliveryCategory);
}

export function mediaPlanItems(items: PlannerItem[], offerings: Map<string, Offering>): PlannerItem[] {
  return items.filter(item => isMediaSchooling(offerings.get(item.offeringId)));
}

export function progressFor(offeringId: string, progress: Record<string, MediaCourseProgress>): MediaCourseProgress {
  return progress[offeringId] ?? { offeringId, totalLessons: null, lessons: [] };
}

export function setTotalLessons(course: MediaCourseProgress, totalLessons: number | null): MediaCourseProgress | null {
  if (totalLessons !== null && (!Number.isInteger(totalLessons) || totalLessons < 1 || totalLessons > 200)) return null;
  if (totalLessons !== null && course.lessons.some(lesson => lesson.lesson > totalLessons && (lesson.videoCompleted || lesson.testCompleted))) return null;
  return { ...course, totalLessons, lessons: course.lessons.filter(lesson => totalLessons === null || lesson.lesson <= totalLessons) };
}

export function toggleLesson(course: MediaCourseProgress, lesson: number, field: 'videoCompleted' | 'testCompleted'): MediaCourseProgress {
  const current = course.lessons.find(entry => entry.lesson === lesson);
  const next: MediaLessonProgress = { lesson, videoCompleted: current?.videoCompleted ?? false, testCompleted: current?.testCompleted ?? false, [field]: !(current?.[field] ?? false) };
  const lessons = [...course.lessons.filter(entry => entry.lesson !== lesson), next]
    .filter(entry => entry.videoCompleted || entry.testCompleted)
    .sort((a, b) => a.lesson - b.lesson);
  return { ...course, lessons };
}

export function mediaProgressSummary(course: MediaCourseProgress): { video: number; test: number; percent: number | null } {
  const video = course.lessons.filter(lesson => lesson.videoCompleted).length;
  const test = course.lessons.filter(lesson => lesson.testCompleted).length;
  return { video, test, percent: course.totalLessons === null ? null : Math.round(((video + test) / (course.totalLessons * 2)) * 100) };
}

export function completedMediaLessons(course: MediaCourseProgress): number {
  return course.lessons.filter(lesson => lesson.videoCompleted && lesson.testCompleted).length;
}

export function mediaSharePost(courseName: string, deliveryCategory: string | null, course: MediaCourseProgress): string {
  const summary = mediaProgressSummary(course);
  const total = course.totalLessons === null ? '未設定' : `${course.totalLessons}回`;
  const completed = course.totalLessons === null ? '—' : `${completedMediaLessons(course)}/${course.totalLessons}回`;
  return [
    `【メディアスクーリング進捗】`,
    courseName,
    deliveryCategory ?? 'メディアスクーリング',
    `進捗 ${completed}（全${total}）`,
    `動画 ${summary.video}回 / テスト ${summary.test}回 / 総合 ${summary.percent === null ? '—' : `${summary.percent}%`}`,
    '#法政通信 #メディアスクーリング',
  ].join('\n');
}
