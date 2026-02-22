import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// 共通部品の読み込み
import Header from './components/Header';
import Footer from './components/Footer';

// 各ページの読み込み
import Home from './pages/Home';
import QA from './pages/QA';
import Contact from './pages/Contact';
import Members from './pages/Members';
import PrivacyPolicy from './pages/PrivacyPolicy';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        
        {/* 切り出したヘッダー */}
        <Header />

        {/* ページの中身が変わる部分 */}
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/qa" element={<QA />} />
            <Route path="/contact" element={<Contact />} />
            
            {/* 隠しページ */}
            <Route path="/draft-members-2026" element={<Members />} />
            <Route path="/draft-privacy-2026" element={<PrivacyPolicy />} />
          </Routes>
        </main>

        {/* 切り出したフッター */}
        <Footer />
        
      </div>
    </Router>
  );
}