import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import PlannerPage from './pages/PlannerPage';
import Footer from './components/Footer';
import PageEdgeNavigation from './components/PageEdgeNavigation';
import { checkSameOriginEnvironment, openSameOriginAuthority, SAME_ORIGIN_AUTHORITY } from './planner/candidate2026/sameOriginAuthority';
import { catalog } from './planner/catalog/catalog';
import { embeddedPlannerParentOrigin, isEmbeddedPlannerBuild, isEmbeddedPlannerDocument } from './planner/candidate2026/embeddedPlanner';

const plannerEnabled = import.meta.env.VITE_PLANNER_2026_URL === '/planner';
const isPlannerPath = () => ['/planner', '/planner/'].includes(window.location.pathname);

function isIsolatedPlannerDocument() {
  const { hostname, protocol } = window.location;
  return isPlannerPath() && window.isSecureContext && window.top === window.self
    && (protocol === 'http:' || protocol === 'https:')
    && ['127.0.0.1', '[::1]', 'localhost'].includes(hostname);
}

function hasLocalEditAccess() {
  // The build flag enables synthetic loopback editing only. There is no
  // trusted production session/entitlement binding in this candidate.
  return plannerEnabled && (isEmbeddedPlannerBuild ? isEmbeddedPlannerDocument() : isIsolatedPlannerDocument())
    && import.meta.env.VITE_PLANNER_2026_ISOLATED_EDIT === '1';
}

const checkEnvironment = () => checkSameOriginEnvironment(
  isEmbeddedPlannerBuild ? isEmbeddedPlannerDocument : undefined,
);

async function canOpenWorkspace() {
  if (!isEmbeddedPlannerBuild) return plannerEnabled && isIsolatedPlannerDocument();
  if (!hasLocalEditAccess() || !navigator.locks) return false;
  try {
    await checkEnvironment();
    return hasLocalEditAccess();
  } catch {
    return false;
  }
}

export function PlannerWorkspace() {
  const [authority] = useState(() => openSameOriginAuthority({
    store: {
      getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => {
        if (!hasLocalEditAccess() || key !== SAME_ORIGIN_AUTHORITY) {
          throw new Error('この文書には編集資格がありません。');
        }
        window.localStorage.setItem(key, value);
      },
    },
    catalog,
    locks: navigator.locks,
    isAdmitted: hasLocalEditAccess,
    checkEnvironment,
  }));

  return <>
    {!hasLocalEditAccess() && <p role="status" className="bg-amber-50 px-4 py-3 text-sm text-amber-950">閲覧・書き出しのみ利用できます。この環境では編集・復元を開始できません。</p>}
    <PlannerPage authority={authority} />
  </>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const appRoot = createRoot(root);
const parentOrigin = embeddedPlannerParentOrigin();
void canOpenWorkspace().then(canOpen => appRoot.render(
  <BrowserRouter>
    {!isEmbeddedPlannerBuild && <nav aria-label="履修プランナーの案内" className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 text-sm text-[#002255]">
      <a className="underline" href="/">法政通信メディア</a>
      <a className="underline" href="/privacy#planner-guide">成績取込・バックアップの使い方</a>
      <a className="underline" href="/privacy">プライバシーポリシー</a>
    </nav>}
    <main>
      {canOpen
        ? <PlannerWorkspace />
        : <p className="p-4" role="status">{plannerEnabled && (isEmbeddedPlannerBuild || isPlannerPath())
          ? 'この配信先の編集資格を確認できないため、履修プランナーの保存領域は開きません。'
          : 'このページでは履修プランナーを利用できません。'}</p>}
    </main>
    {canOpen && <PageEdgeNavigation plannerPath={window.location.pathname} />}
    {parentOrigin && <Footer parentOrigin={parentOrigin} />}
  </BrowserRouter>,
));
