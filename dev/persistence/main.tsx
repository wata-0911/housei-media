import { createRoot } from 'react-dom/client';
import { PersistencePage } from './PersistencePage';
import '../attempts/style.css';
const root = document.getElementById('root');
if (!root) throw new Error('missing_root');
createRoot(root).render(<PersistencePage />);
