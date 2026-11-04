// Only the production environment of the exact dedicated dev project is allowed.
// Preview, missing and unknown Vercel environments always fail closed.
export function calendarDeploymentAllowed(): boolean {
  if (process.env.VERCEL === '1') return process.env.VERCEL_ENV === 'production' &&
    process.env.CALENDAR_APPROVAL_ENABLED === 'true' &&
    process.env.VERCEL_GIT_COMMIT_REF === 'dev' && process.env.VERCEL_GIT_REPO_OWNER === 'wata-0911' && process.env.VERCEL_GIT_REPO_SLUG === 'housei-media' && !!process.env.VERCEL_PROJECT_ID &&
    process.env.VERCEL_PROJECT_ID === process.env.CALENDAR_APPROVAL_DEV_PROJECT_ID;
  return process.env.VERCEL === undefined && process.env.NODE_ENV !== 'production' && process.env.CALENDAR_LOCAL_TEST_MODE === 'true';
}
export function calendarUnavailable(): Response {
  return Response.json({ ok: false, code: 'calendar_unavailable' }, { status: 404, headers: { 'Cache-Control': 'no-store, private' } });
}
