import { lazy, Suspense } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import Header from '../../src/components/Header';
import PageEdgeNavigation from '../../src/components/PageEdgeNavigation';
import QA from '../../src/pages/QA';

const Planner = lazy(() => import('../../src/pages/InstitutionalPlannerPage'));
const Legacy = lazy(() => import('../../src/pages/PlannerPage'));

function Layout() {
  return <><Header /><main><Suspense fallback={<p role="status">履修プランナーを読み込み中…</p>}>
    <Outlet />
  </Suspense></main><PageEdgeNavigation plannerPath="/__dev/ac" includeMedia={false} /></>;
}

const router = createBrowserRouter([{ element: <Layout />, children: [
  { path: '/__dev/ac', element: <Planner /> },
  { path: '/qa', element: <QA /> },
  { path: '/planner/*', element: <Legacy /> },
] }]);

export default function AcApp() {
  return <RouterProvider router={router} />;
}
