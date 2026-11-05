import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from '../../src/components/Header';
import PageEdgeNavigation from '../../src/components/PageEdgeNavigation';
import QA from '../../src/pages/QA';
const Planner = lazy(() => import('../../src/pages/InstitutionalPlannerPage'));
const Legacy = lazy(() => import('../../src/pages/PlannerPage'));
export default function AcApp() {
  return <BrowserRouter><Header /><main><Suspense fallback={<p role="status">履修プランナーを読み込み中…</p>}><Routes>
    <Route path="/__dev/ac" element={<Planner />} />
    <Route path="/qa" element={<QA />} />
    <Route path="/planner/*" element={<Legacy />} />
  </Routes></Suspense></main><PageEdgeNavigation plannerPath="/__dev/ac" includeMedia={false} /></BrowserRouter>;
}
