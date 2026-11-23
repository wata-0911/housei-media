function loopbackOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
      && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

const mode = import.meta.env.MODE;
export const isStage69ParentBuild = mode === 'stage69-parent';
const isStage69ChildBuild = mode === 'stage69-child';
const isProductionParent = mode === 'main-planner-parent';
const isProductionChild = mode === 'main-planner-child';
export const isEmbeddedPlannerParentBuild = mode === 'stage65-parent' || isStage69ParentBuild || isProductionParent;
export const isEmbeddedPlannerBuild = mode === 'stage65-child' || isStage69ChildBuild || isProductionChild;

const plannerDestinations = new Set(['#grade-import', '#media', '#media-panel',
  '#course-query', '#graduation-progress-heading', '#planned-heading']);

function embeddedOrigins() {
  if (isProductionParent || isProductionChild) {
    if (import.meta.env.VITE_PLANNER_2026_URL !== '/planner') return null;
    return {
      parent: 'https://hosei-tsukyo-media.com',
      child: 'https://planner.hosei-tsukyo-media.com',
      childPath: '/child',
    };
  }
  if (isStage69ParentBuild || isStage69ChildBuild) {
    if (import.meta.env.VITE_PLANNER_2026_URL !== '/planner') return null;
    return {
      parent: 'https://staging.hosei-tsukyo-media.com',
      child: 'https://planner-staging.hosei-tsukyo-media.com',
      childPath: '/child',
    };
  }
  if (import.meta.env.VITE_PLANNER_2026_URL !== '/planner'
    || import.meta.env.VITE_PLANNER_2026_ISOLATED_EDIT !== '1') return null;
  const parent = loopbackOrigin(import.meta.env.VITE_PLANNER_2026_PARENT_ORIGIN);
  const child = loopbackOrigin(import.meta.env.VITE_PLANNER_2026_CHILD_ORIGIN);
  return parent && child && parent !== child ? { parent, child, childPath: '/planner.html' } : null;
}

export function embeddedPlannerSource(hash = window.location.hash) {
  if (!isEmbeddedPlannerParentBuild) return null;
  const sites = embeddedOrigins();
  return sites && window.isSecureContext && window.self === window.top
    && window.location.origin === sites.parent
    && ['/planner', '/planner/'].includes(window.location.pathname)
    ? `${sites.child}${sites.childPath}${plannerDestinations.has(hash) ? hash : ''}` : null;
}

export function isEmbeddedPlannerDocument() {
  if (!isEmbeddedPlannerBuild) return false;
  if (isStage69ChildBuild && import.meta.env.VITE_PLANNER_2026_STAGING_EDIT !== '1') return false;
  if (isProductionChild && import.meta.env.VITE_PLANNER_2026_PRODUCTION_EDIT !== '1') return false;
  const sites = embeddedOrigins();
  return !!sites && window.isSecureContext
    && window.self !== window.top && window.parent === window.top
    && window.location.origin === sites.child && window.location.pathname === sites.childPath
    && document.referrer === `${sites.parent}/`;
}

export function embeddedPlannerParentOrigin() {
  const sites = embeddedOrigins();
  return isEmbeddedPlannerBuild && sites && window.self !== window.top && window.parent === window.top
    && window.location.origin === sites.child && document.referrer === `${sites.parent}/` ? sites.parent : null;
}
