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

export type MediaShareCourse = { name: string; videoCompletedCount: number; testCompletedCount: number; totalLessons: number | null; videoDone: boolean; testDone: boolean };
export type MediaShareGroup = { deliveryCategory: '前期メディア' | '後期メディア'; courses: MediaShareCourse[]; totalVideoCompleted: number; totalTestCompleted: number; totalLessons: number | null; unconfiguredCourses: number };

export function mediaShareViewModel(items: PlannerItem[], offerings: Map<string, Offering>, progress: Record<string, MediaCourseProgress>): MediaShareGroup[] {
  const groups = new Map<MediaShareGroup['deliveryCategory'], MediaShareGroup>();
  for (const item of mediaPlanItems(items, offerings)) {
    const offering = offerings.get(item.offeringId)!;
    const deliveryCategory = offering.deliveryCategory as MediaShareGroup['deliveryCategory'];
    const course = progressFor(item.offeringId, progress);
    const { video: videoCompletedCount, test: testCompletedCount } = mediaProgressSummary(course);
    const row: MediaShareCourse = { name: offering.name, videoCompletedCount, testCompletedCount, totalLessons: course.totalLessons, videoDone: course.totalLessons !== null && videoCompletedCount === course.totalLessons, testDone: course.totalLessons !== null && testCompletedCount === course.totalLessons };
    const group = groups.get(deliveryCategory) ?? { deliveryCategory, courses: [], totalVideoCompleted: 0, totalTestCompleted: 0, totalLessons: 0, unconfiguredCourses: 0 };
    group.courses.push(row);
    group.totalVideoCompleted += videoCompletedCount;
    group.totalTestCompleted += testCompletedCount;
    if (course.totalLessons === null) group.unconfiguredCourses += 1;
    else group.totalLessons = (group.totalLessons ?? 0) + course.totalLessons;
    groups.set(deliveryCategory, group);
  }
  const categoryOrder: MediaShareGroup['deliveryCategory'][] = ['前期メディア', '後期メディア'];
  return categoryOrder.flatMap(category => {
    const group = groups.get(category);
    return group ? [{ ...group, totalLessons: group.unconfiguredCourses === 0 ? group.totalLessons : null }] : [];
  });
}

export function mediaSharePost(groups: MediaShareGroup[], comment = ''): string {
  const lines = groups.flatMap((group, index) => [
    ...(index === 0 ? [] : ['']), `${group.deliveryCategory}進捗`,
    ...group.courses.map(course => course.totalLessons === null
      ? `・${course.name}  動画 ${course.videoCompletedCount}回・テスト ${course.testCompletedCount}回（全回数未設定）`
      : `・${course.name}  動画 ${course.videoCompletedCount}/${course.totalLessons}${course.videoDone ? ' ✅' : ''}・テスト ${course.testCompletedCount}/${course.totalLessons}${course.testDone ? ' ✅' : ''}`),
    ...(group.totalLessons === null ? ['全回数未設定の科目あり'] : [`動画トータル  ${group.totalVideoCompleted}/${group.totalLessons}`, `テストトータル  ${group.totalTestCompleted}/${group.totalLessons}`]),
  ]);
  return [...lines, ...(comment.trim() ? ['', comment.trim()] : [])].join('\n');
}

export function mediaShareIntentUrl(post: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(post)}`;
}
