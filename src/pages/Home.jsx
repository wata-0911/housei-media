import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  // 検索ボタンやEnterキーが押されたときの処理
  const handleSearch = (e) => {
    e.preventDefault();
    if (keyword.trim() !== '') {
      // 入力された文字をURLにくっつけてQ&Aページへ移動
      navigate(`/qa?q=${encodeURIComponent(keyword)}`);
    } else {
      navigate('/qa');
    }
  };

  return (
    <div>
      {/* ヒーローセクション */}
      <section 
        className="text-white py-16 md:py-20 bg-cover bg-center relative" 
        style={{ backgroundImage: "url('/hedda.jpeg')" }}
      >
        <div className="container mx-auto px-4 text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-extrabold mb-4 drop-shadow-lg leading-tight">
            法政通信メディア
          </h2>
          <p className="text-sm md:text-lg opacity-90 drop-shadow-md break-keep">
            最新のメディア情報とコンテンツをお届けします
          </p>
        </div>
      </section>

      {/* 検索セクション追加 */}
      <section className="bg-blue-50 py-8 border-b border-blue-100">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-md text-center">
            <h3 className="text-xl font-bold text-gray-800 mb-4">知りたいことはありますか？</h3>
            <form onSubmit={handleSearch} className="relative max-w-2xl mx-auto">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="キーワードでQ&Aを検索 (例: スクーリング、試験...)"
                className="w-full pl-11 pr-24 py-3 md:py-4 border border-gray-300 rounded-full shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-base"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button 
                type="submit"
                className="absolute right-2 top-2 bottom-2 bg-blue-800 text-white px-6 rounded-full font-bold hover:bg-blue-700 transition"
              >
                検索
              </button>
            </form>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          {/* 既存のコンテンツ */}
          <article className="bg-white p-6 md:p-8 rounded-lg shadow-md mb-8">
            <h3 className="text-xl md:text-2xl font-bold mb-4 border-b pb-2">通教生向けスケジュール</h3>
            <p className="leading-relaxed text-sm md:text-base text-gray-700">
              冬スクお疲れ様でした！！
              25年度の学習も一区切りですね！
              通教生向けに2月のスケジュールをまとめておきました！！
              見やすいなと思って貰えたら《いいね.RP》で広めて貰えると嬉しいです！
              <img src="/caren.jpg" alt="カレンダー" className="w-full mt-4 rounded-lg shadow-md" />
            </p>
          </article>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <h4 className="font-bold mb-2 text-lg text-blue-800">法政通信メディア＠勉強・就職情報発信</h4>
              <p className="text-sm text-gray-600">
                法政通教生が運営する通教生のための情報メディア！あなたの学生生活に必要な情報や役立つ情報を発信していきます！忘れがちな振込締切日や成績更新情報なども適宜発信中！
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
              <h4 className="font-bold mb-2 text-lg text-blue-800">締切リマインド＠法政通信メディア2nd</h4>
              <p className="text-sm text-gray-600">
                通信教育課程に関連する様々なことをXにてリマインドします！
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}