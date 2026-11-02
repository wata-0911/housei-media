import { createRoot } from 'react-dom/client';
import { AuthorityV2Page } from './AuthorityV2Page';
import '../attempts/style.css';
const root = document.getElementById('root');
if (!root) throw new Error('missing_root');
createRoot(root).render(<AuthorityV2Page />);
