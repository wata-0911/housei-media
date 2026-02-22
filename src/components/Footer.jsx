import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-gray-800 text-gray-300 py-10 mt-auto">
      <div className="container mx-auto px-4 max-w-5xl">
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-gray-700 pb-8 mb-8">
          
          <div className="footer-section">
            <h3 className="text-xl font-bold text-white mb-4">法政通信メディア</h3>
            <p className="text-sm text-gray-400 leading-relaxed mb-6">
              法政大学通信教育部生のための情報メディア。<br />
              学生生活に役立つ情報を発信しています。
            </p>
            {/* X(Twitter)アイコン */}
            <div className="flex space-x-4">
              <a 
                href="https://x.com/hosei_c_media" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-gray-400 hover:text-white transition-colors duration-200"
                aria-label="X (Twitter) 公式アカウント"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 22.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>

          <div className="footer-section">
            <h4 className="text-lg font-bold text-white mb-4">コンテンツ</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-blue-400 transition">ホーム</Link></li>
              <li><Link to="/qa" className="hover:text-blue-400 transition">よくある質問 (Q&A)</Link></li>
              <li><Link to="/contact" className="hover:text-blue-400 transition">お問い合わせ</Link></li>
            </ul>
          </div>

          <div className="footer-section">
            <h4 className="text-lg font-bold text-white mb-4">運営情報</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/draft-members-2026" className="hover:text-blue-400 transition">運営メンバー募集</Link></li>
              <li><Link to="/draft-privacy-2026" className="hover:text-blue-400 transition">プライバシーポリシー・免責</Link></li>
            </ul>
          </div>

        </div>

        <div className="text-center text-sm text-gray-500">
          <p>&copy; 2026 法政通信メディア. All rights reserved.</p>
        </div>

      </div>
    </footer>
  );
}