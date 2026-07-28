import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Header() {
  // 検索バーの開閉状態と、入力されたキーワードを管理
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  // 検索を実行したときの処理
  const handleSearch = (e) => {
    e.preventDefault();
    if (keyword.trim() !== '') {
      // Q&Aページにキーワードを渡して移動
      navigate(`/qa?q=${encodeURIComponent(keyword)}`);
      setIsSearchOpen(false); // 検索バーを閉じる
      setKeyword(''); // 入力内容をリセット
    }
  };

  return (
    <header 
      className="sticky top-0 z-50 bg-[#002255]/95 backdrop-blur-md border-b border-white/10 transition-all duration-300 relative"
      style={{ fontFamily: '"Noto Serif JP", serif' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0">
        
        {/* ロゴ部分 */}
        <Link to="/" className="text-xl md:text-2xl font-medium tracking-widest text-white flex items-baseline hover:text-[#E65C00] transition-colors duration-300">
          法政通信メディア
        </Link>

        {/* ナビゲーションメニュー */}
        <nav className="flex items-center">
          <ul className="flex space-x-5 md:space-x-8 text-sm tracking-widest font-light text-white/80 items-center">
            <li>
              <Link to="/" className="hover:text-[#E65C00] transition-colors duration-300">ホーム</Link>
            </li>
            <li>
               <Link to="/draft-message-2026" className="hover:text-[#E65C00] transition-colors duration-300">創立者からのメッセージ</Link>
            </li>
            <li>
              <Link to="/qa" className="hover:text-[#E65C00] transition-colors duration-300">よくある質問</Link>
            </li>
            <li>
              <Link to="/contact" className="hover:text-[#E65C00] transition-colors duration-300">お問い合わせ</Link>
            </li>
            
            {/* 区切り線 */}
            <li className="h-4 w-[1px] bg-white/20 hidden md:block"></li>

            {/* 虫眼鏡（検索）アイコン */}
            <li>
              <button 
                onClick={() => setIsSearchOpen(!isSearchOpen)}
                className={`flex items-center transition-colors duration-300 ${isSearchOpen ? 'text-[#E65C00]' : 'hover:text-[#E65C00]'}`}
                aria-label="検索を開く"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
              </button>
            </li>
          </ul>
        </nav>
      </div>

      {/* ドロップダウン型 検索バー */}
      {isSearchOpen && (
        <div className="absolute top-[100%] right-4 md:right-8 mt-2 w-72 bg-white shadow-2xl p-2 rounded-lg border border-gray-100 z-50">
          <form 
            onSubmit={handleSearch} 
            className="flex items-center bg-[#FAFAFA] rounded-md px-3 py-2 border border-transparent focus-within:border-[#002255] transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input
              type="text"
              placeholder="キーワードでQ&Aを検索..."
              className="w-full bg-transparent outline-none text-[#1A1A1A] text-sm font-light tracking-wide placeholder-gray-400"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              autoFocus // 開いた瞬間にすぐ入力できるようにする
            />
          </form>
        </div>
      )}
    </header>
  );
}