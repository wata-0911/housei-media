import { createRoot } from 'react-dom/client';
import { InstitutionalSearch } from './InstitutionalSearch';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing_root');
createRoot(root).render(<InstitutionalSearch />);
