import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-[#002255] text-white/80 py-16 border-t border-white/10 mt-auto" style={{ fontFamily: '"Noto Serif JP", serif' }}>
      <div className="max-w-7xl mx-auto px-6 text-center antialiased">
        <p className="text-sm text-white tracking-widest font-light mb-8">
          法政通信メディア
        </p>

        <div className="flex justify-center mb-10">
          <a 
            href="https://x.com/hosei_c_media" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-white/60 hover:text-[#E65C00] transition-colors duration-300"
            aria-label="X (Twitter) 公式アカウント"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 22.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>

        <div className="flex flex-wrap justify-center gap-6 md:gap-10 mb-12 text-xs md:text-sm tracking-widest font-light">
          <Link to="/" className="text-white hover:text-[#E65C00] transition-colors duration-300">ホーム</Link>
          <Link to="/qa" className="text-white hover:text-[#E65C00] transition-colors duration-300"></Link>
          <Link to="/draft-message-2026" className="text-white hover:text-[#E65C00] transition-colors duration-300">創立者からのメッセージ</Link>
          <Link to="/member" className="text-white hover:text-[#E65C00] transition-colors duration-300">運営メンバー紹介</Link>
          <Link to="/draft-privacy-2026" className="text-white hover:text-[#E65C00] transition-colors duration-300">プライバシーポリシー</Link>
          <Link to="/contact" className="text-white hover:text-[#E65C00] transition-colors duration-300">お問い合わせ</Link>
        </div>

        <p className="text-xs text-white/40 tracking-widest font-light">
          &copy; 2026 法政通信メディア. All Rights Reserved.
        </p>
      </div>
    </footer>
  );
}