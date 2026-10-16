import { createRoot } from 'react-dom/client';
import './style.css';
import { Workbench } from './Workbench';

const root = document.getElementById('root');
if (!root) throw new Error('missing_root');
createRoot(root).render(<Workbench />);
