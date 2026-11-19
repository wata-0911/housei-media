import { createRoot } from 'react-dom/client';
import { legacyPlannerLink } from './deployment';
import { createBootPreflight } from './preflight';
import './styles.css';

async function mount() {
  const root = createRoot(document.getElementById('root')!);
  try {
    if (window.top !== window.self || !window.isSecureContext) throw new Error('Standalone secure document required');
    const response = await fetch('/planner-2026-deployment.json', {
      credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) throw new Error('Missing deployment configuration');
    const oldUrl = legacyPlannerLink(await response.json(), location.origin);
    const store = window.localStorage;
    const preflight = createBootPreflight(store, navigator.serviceWorker);
    await preflight.check();
    const [{ Planner2026 }, { download, openProductMedia }] = await Promise.all([import('./Preview'), import('./planner')]);
    const media = openProductMedia(store, preflight);
    const initial = await media.read();
    preflight.checkLocal();

    if (initial.status === 'hold') {
      root.render(<main><h1>2026年度 履修プランナーを開始できません</h1>
        <p role="alert">保存の状態を確認できません。原本を保全するため編集と復元を保留します。</p>
        <button type="button" onClick={() => {
          void media.exportQuarantine().then(
            raw => download(raw, 'hosei-planner-2026-originals.json'),
            () => renderBlocked(),
          );
        }}>新版の保存原文を保護用に保存</button></main>);
      preflight.subscribe(renderBlocked);
      return;
    }
    root.render(<Planner2026 oldUrl={oldUrl} media={media} initial={initial} preflight={preflight} />);
  } catch {
    renderBlocked();
  }

  function renderBlocked() {
    root.render(<main><h1>2026年度 履修プランナーを開始できません</h1>
      <p role="alert">新版の配置先、旧版の保存領域、またはService Workerの状態を確認してください。編集と復元は保留しています。</p></main>);
  }
}

void mount();
