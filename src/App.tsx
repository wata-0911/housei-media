import { useEffect, useRef, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigationType,
} from 'react-router-dom';

// 共通部品の読み込み
import Header from './components/Header';
import Footer from './components/Footer';
import PageEdgeNavigation from './components/PageEdgeNavigation';
import ViewportBottomAd, { hasViewportBottomAd } from './components/ViewportBottomAd';

// 各ページの読み込み
import Home from './pages/Home';
import QA from './pages/QA';
import Contact from './pages/Contact';
import Message from './pages/Message'; // 重複を削除し、1つにまとめました
import PrivacyPolicy from './pages/PrivacyPolicy';
import ProfileCard from './pages/member';
import NotFound from './pages/NotFound'
import { embeddedPlannerSource, isEmbeddedPlannerParentBuild } from './planner/candidate2026/embeddedPlanner';

function EmbeddedPlanner() {
  const { hash } = useLocation();
  const src = embeddedPlannerSource(hash);
  if (!src) return <p role="status" className="p-4">この環境では履修プランナーを利用できません。</p>;

  // Allow the admitted Planner frame to focus its own hash destination on entry.
  const childOrigin = new URL(src).origin;
  return <iframe
    title="2026年度版 履修プランナー"
    src={src}
    sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-top-navigation-by-user-activation"
    allow={`clipboard-write ${childOrigin}; web-share ${childOrigin}; focus-without-user-activation ${childOrigin}`}
    referrerPolicy="origin"
    className="absolute inset-0 block h-full w-full border-0"
  />;
}

type PageMetaEntry = {
  title: string
  description: string
}

const pageMeta: Record<string, PageMetaEntry> = {
  '/': {
    title: '法政通信メディア | 勉強・就職・学生生活の情報まとめ',
    description:
      '法政大学通信教育部の学生向け情報サイト。単位修得、リポート・試験、スクーリング、就職活動など学生生活に役立つ情報を掲載しています。',
  },

  '/qa': {
    title: 'Q&A | 法政通信メディア',
    description:
      '法政大学通信教育部の学生生活、単位、試験、スクーリング、履修などに関するQ&Aをまとめています。',
  },

  '/contact': {
    title: 'お問い合わせ | 法政通信メディア',
    description:
      '法政通信メディアへのお問い合わせページです。',
  },

  '/message': {
    title: '創立者からのメッセージ | 法政通信メディア',
    description:
      '法政通信メディア創立者からのメッセージを掲載しています。',
  },

  '/privacy': {
    title: 'プライバシーポリシー・免責事項 | 法政通信メディア',
    description:
      '法政通信メディアのプライバシーポリシー、免責事項、著作権等について掲載しています。',
  },

  '/member': {
    title: '運営メンバー | 法政通信メディア',
    description:
      '法政通信メディアを運営するメンバーを紹介しています。',
  },
};

const fallbackMeta: PageMetaEntry = {
  title: 'ページが見つかりません | 法政通信メディア',
  description: 'お探しのページは見つかりませんでした。',
}

function normalizePathname(pathname: string) {
  return pathname.replace(/\/+$/, '').toLowerCase() || '/'
}

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navigationType = useNavigationType()
  const normalizedPathname = normalizePathname(pathname)
  const previousPathname = useRef(normalizedPathname)

  useEffect(() => {
    const changedPage = previousPathname.current !== normalizedPathname
    previousPathname.current = normalizedPathname

    if (changedPage && navigationType !== 'POP' && !hash) {
      window.scrollTo(0, 0)
    }
  }, [normalizedPathname, navigationType, hash])

  return null
}

function PageMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const normalizedPathname = normalizePathname(pathname)
    const meta = isEmbeddedPlannerParentBuild && normalizedPathname === '/planner'
      ? { title: '2026年度版 履修プランナー | 法政通信メディア', description: '2026年度の履修計画、成績取込、進捗と単位の記録。' }
      : pageMeta[normalizedPathname] ?? fallbackMeta

    document.title = meta.title;

    const description = document.querySelector(
      'meta[name="description"]'
    );

    if (description) {
      description.setAttribute('content', meta.description);
    }

    let canonical = document.querySelector(
      'link[rel="canonical"]'
    );

    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }

    canonical.setAttribute(
      'href',
      `https://hosei-tsukyo-media.com${normalizedPathname}`
    );
  }, [pathname]);

  return null;
}
function SiteLayout() {
  const { pathname } = useLocation();
  const [adInset, setAdInset] = useState(0);
  const embedded = ['/planner', '/planner/'].includes(pathname) && embeddedPlannerSource() !== null;
  return <>
      <PageMeta />
      <ScrollToTop />

      <div className={`bg-gray-50 ${embedded ? 'grid grid-rows-[auto_minmax(0,1fr)]' : 'flex min-h-screen flex-col'}`}
        style={embedded ? { minHeight: 'calc(100dvh - ' + adInset + 'px)' } : { paddingBottom: adInset }}>
        {/* 切り出したヘッダー */}
        <Header />

        {/* ページの中身が変わる部分 */}
        <main className={embedded ? 'relative min-h-0' : 'flex-grow'}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/qa" element={<QA />} />
            <Route path="/contact" element={<Contact />} />
            {/* 創立者からのメッセージページへのルーティング */}
            <Route path="/message" element={<Message />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            {isEmbeddedPlannerParentBuild && <Route path="/planner" element={<EmbeddedPlanner />} />}
            <Route path="/member" element={<ProfileCard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        {/* 切り出したフッター */}
        {!embedded && <Footer />}

      </div>
      {!embedded && <PageEdgeNavigation bottomInset={adInset} reloadPlannerLocation
        plannerPath={import.meta.env.VITE_PLANNER_2026_URL === '/planner' ? '/planner' : null} />}
      {hasViewportBottomAd && <ViewportBottomAd onInsetChange={setAdInset} />}
    </>;
}

export default function App() { return <Router><SiteLayout /></Router>; }
