export const IMPORT_RESULT_TARGET = 'curriculum-course-list';

/** Wait until React has committed the imported rows, then move focus to their list. */
export function focusImportedCourseList() {
  requestAnimationFrame(() => {
    const target = document.getElementById(IMPORT_RESULT_TARGET);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
