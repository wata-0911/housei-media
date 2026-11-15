import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { YearIndependentSearchSidecar } from '../src/components/planner/institutional/YearIndependentSearchSidecar';
createRoot(document.getElementById('root')!).render(<StrictMode><YearIndependentSearchSidecar /></StrictMode>);
