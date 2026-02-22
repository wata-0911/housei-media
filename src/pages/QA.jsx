import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qaData } from '../data/qaData';

const groupByCategory = (data) => {
  return data.reduce((acc, item) => {
    const key = item.category || "その他";
    if (!acc[key]) {
      acc[key] = [];
    }
    const isDuplicate = acc[key].some(
      (existing) => existing.question === item.question
    );
    if (!isDuplicate) {
      acc[key].push(item);
    }
    return acc;
  }, {});
};

export default function QA() {
  // URLのパラメータ（?q=キーワード）を取得する機能
  const [searchParams, setSearchParams] = useSearchParams();
  
  // 初期値をURLパラメータから取得（なければ空文字）
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  // 検索窓に入力があったときの処理
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    
    // URLの表示もリアルタイムで書き換える
    if (val) {
      setSearchParams({ q: val });
    } else {
      setSearchParams({});
    }
  };

  const filteredData = qaData.filter((item) => {
    const query = searchQuery.toLowerCase();
    return (
      item.question.toLowerCase().includes(query) ||
      item.answer.toLowerCase().includes(query) ||
      (item.category && item.category.toLowerCase().includes(query))
    );
  });

  const categorizedQA = groupByCategory(filteredData);
  const categories = Object.keys(categorizedQA);

  return (
    <div>
      <section className="bg-blue-800 text-white py-12">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold">よくある質問 (Q&A)</h2>
          <p className="opacity-90 mt-2 text-sm md:text-base">学生生活の疑問を解消しましょう</p>
        </div>
      </section>
      
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-3xl mx-auto">

          {/* 検索窓の実装 */}
          <div className="mb-10 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="キーワードで検索 (例: スクーリング、試験、単位...)"
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              value={searchQuery}
              onChange={handleSearchChange}
            />
          </div>
          
          {/* 目次 */}
          {categories.length > 0 && (
            <div className="mb-12">
              <div className="flex flex-wrap justify-center gap-3">
                {categories.map((cat, index) => (
                  <a 
                    key={index} 
                    href={`#category-${index}`} 
                    className="bg-white text-blue-800 border border-blue-200 px-4 py-2 rounded-full text-sm font-bold shadow-sm hover:bg-blue-50 hover:shadow-md transition"
                  >
                    {cat} ▼
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 検索結果ゼロの場合 */}
          {categories.length === 0 && (
            <div className="text-center py-10 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-600 font-bold">「{searchQuery}」に一致する質問は見つかりませんでした。</p>
              <p className="text-sm text-gray-500 mt-2">別のキーワードでお試しいただくか、お問い合わせフォームよりご質問ください。</p>
            </div>
          )}

          {/* Q&Aリスト */}
          <div className="space-y-12">
            {categories.map((category, catIndex) => (
              <div key={catIndex} id={`category-${catIndex}`} className="scroll-mt-24">
                <h3 className="text-2xl font-bold text-gray-800 border-b-2 border-blue-200 pb-2 mb-6">
                  {category}
                </h3>
                
                <div className="space-y-4">
                  {categorizedQA[category].map((item, qIndex) => (
                    <details key={qIndex} className="group bg-white rounded-lg border border-gray-200 shadow-sm">
                      <summary className="flex justify-between items-center cursor-pointer p-4 font-bold text-gray-800 list-none">
                        <span className="flex items-center gap-3 text-sm md:text-base">
                          <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded shrink-0">Q</span>
                          {item.question}
                        </span>
                        <span className="text-gray-400 transition-transform group-open:rotate-180 shrink-0 ml-2">▼</span>
                      </summary>
                      <div className="p-4 border-t border-gray-100 text-gray-600 bg-gray-50 rounded-b-lg text-sm md:text-base whitespace-pre-wrap">
                        <p>
                          <span className="font-bold text-blue-600">A.</span> {item.answer}
                        </p>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}