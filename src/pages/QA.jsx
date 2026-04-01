import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
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
    <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen" style={{ fontFamily: '"Noto Serif JP", serif' }}>

      {/* 修正：背景画像付きのヘッダーセクション */}
      <section
        className="relative py-24 md:py-32 bg-cover bg-center text-white overflow-hidden"
        style={{ backgroundImage: "url('/qa.jpeg')" }}
      >

        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="block text-[#E65C00] text-sm tracking-[0.2em] font-medium mb-4"
          >
            FAQ
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl md:text-5xl font-light tracking-wider drop-shadow-lg"
          >
            よくある質問
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-white/90 mt-6 text-sm md:text-base tracking-widest font-light drop-shadow-md"
          >
            学生生活の疑問を解消しましょう。
          </motion.p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto">

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16 relative"
          >
            <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-[#C6A87C]" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="キーワードで検索 (例: スクーリング、試験、単位...)"
              className="w-full pl-14 pr-6 py-4 bg-white border border-gray-200 shadow-sm focus:ring-2 focus:ring-[#002255] focus:border-[#002255] outline-none transition-all duration-300 font-light tracking-wide text-[#1A1A1A] placeholder-gray-400"
              value={searchQuery}
              onChange={handleSearchChange}
            />
          </motion.div>

          {categories.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mb-16"
            >
              <div className="flex flex-wrap justify-center gap-4">
                {categories.map((cat, index) => (
                  <a
                    key={index}
                    href={`#category-${index}`}
                    className="px-5 py-2 bg-white text-[#002255] border border-gray-200 text-sm tracking-widest font-medium hover:bg-[#002255] hover:text-white transition-colors duration-300 shadow-sm"
                  >
                    {cat}
                  </a>
                ))}
              </div>
            </motion.div>
          )}

          {categories.length === 0 && (
            <div className="text-center py-16 bg-white border border-gray-100 shadow-sm">
              <p className="text-[#002255] font-medium text-lg tracking-wide">「{searchQuery}」に一致する質問は見つかりませんでした。</p>
              <p className="text-sm text-[#666666] mt-4 font-light tracking-wide">別のキーワードでお試しいただくか、お問い合わせフォームよりご質問ください。</p>
            </div>
          )}

          <div className="space-y-16">
            {categories.map((category, catIndex) => (
              <motion.div
                key={catIndex}
                id={`category-${catIndex}`}
                className="scroll-mt-32"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
              >
                <h3 className="text-2xl font-medium text-[#002255] border-b border-[#C6A87C] pb-4 mb-8 tracking-wider flex items-center">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  {category}
                </h3>

                <div className="space-y-4">
                  {categorizedQA[category].map((item, qIndex) => (
                    <details
                      key={qIndex}
                      className="group bg-white border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-md"
                    >
                      <summary className="flex justify-between items-center cursor-pointer p-6 font-medium text-[#1A1A1A] list-none tracking-wide">
                        <span className="flex items-start gap-4 text-sm md:text-base pr-8 leading-relaxed">
                          <span className="text-[#E65C00] font-bold text-lg leading-none mt-0.5 shrink-0">Q.</span>
                          {item.question}
                        </span>
                        <span className="text-[#C6A87C] transition-transform duration-300 group-open:rotate-180 shrink-0">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </span>
                      </summary>
                      <div className="p-6 pt-0 border-t border-gray-50 text-[#666666] bg-white text-sm md:text-base whitespace-pre-wrap font-light leading-loose tracking-wide">
                        <div className="flex items-start gap-4 mt-4">
                          <span className="text-[#002255] font-bold text-lg leading-none mt-1 shrink-0">A.</span>
                          <p>{item.answer}</p>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}