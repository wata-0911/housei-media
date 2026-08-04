import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import XTimeline from '../components/XTimeline';

export default function Home() {
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  // スクロールに応じたパララックス（視差効果）用の設定
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, 150]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);

  // Noto Serif JPフォントを適用するための処理
  useEffect(() => {
    // index.htmlをいじらなくても、React側でフォントを読み込む
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (keyword.trim() !== '') {
      navigate(`/qa?q=${encodeURIComponent(keyword)}`);
    } else {
      navigate('/qa');
    }
  };

  return (
    // font-serifを指定し、全体をNoto Serif JPに。背景は上品なオフホワイト（canvas）
    <div className="bg-[#FAFAFA] text-[#1A1A1A] antialiased" style={{ fontFamily: '"Noto Serif JP", serif' }}>

      {/* ヒーローセクション（パララックス効果付き） */}
      <header className="relative h-screen flex items-center justify-center overflow-hidden">
        {/* 背景画像（スクロールで少し遅れて動くパララックス） */}
        <motion.div
          style={{ y: heroY }}
          className="absolute inset-0 z-0"
        >
          {/* 青みを少し加えたオーバーレイ */}
          <div className="absolute inset-0 bg-[#002255]/40 z-10"></div>
          <img
            src="/hedda.jpeg"
            alt="法政大学イメージ"
            className="w-full h-full object-cover scale-105" // 少し拡大してパララックスの余白を作る
          />
        </motion.div>

        {/* メインコピー */}
        <motion.div
          style={{ opacity }}
          className="relative z-20 text-center text-white px-4 mt-20"
        >
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="block text-sm md:text-base tracking-[0.15em] mb-6 text-white/90 font-light"
          >
            法政大学通信教育部 学生生活ガイド
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
            className="text-4xl md:text-6xl lg:text-7xl font-light leading-tight tracking-wider mb-8 drop-shadow-lg"
          >
            誰かの「困った」を<br />「良かった」に変えるために。
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1 }}
            className="text-lg md:text-xl font-light tracking-wider text-white/80 max-w-2xl mx-auto"
          >
            法政通信メディアは皆様の学生生活に役立つ情報をまとめています。
          </motion.p>
        </motion.div>

        {/* スクロールインジケーター */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.5 }}
          className="absolute bottom-12 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center text-white/90"
        >
          <span className="text-xs tracking-[0.2em] mb-3 font-light">SCROLL</span>
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="w-[1px] h-12 bg-white/60"
          />
        </motion.div>
      </header>

      {/* 検索セクション */}
      <section className="py-20 bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h3 className="text-[#002255] text-2xl font-medium mb-8 tracking-wider">知りたいことはありますか？</h3>
            <form onSubmit={handleSearch} className="relative flex items-center border-b border-gray-300 pb-2 transition-colors focus-within:border-[#002255]">
              <svg className="w-5 h-5 text-gray-400 mr-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input
                type="text"
                placeholder="キーワードでQ&Aを検索 (例: スクーリング、試験...)"
                className="w-full bg-transparent outline-none text-[#1A1A1A] placeholder-gray-400 font-light tracking-wide"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button type="submit" className="text-[#E65C00] hover:text-[#002255] transition-colors ml-4 text-sm tracking-widest uppercase font-medium">
                Search
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* セクション1: SCHEDULE */}
      <section className="py-32 bg-[#F5F5F7] overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col md:flex-row items-center">

            {/* テキストエリア */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
              className="w-full md:w-5/12 bg-white p-10 md:p-16 relative z-10 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)]"
            >
              <span className="text-[#E65C00] text-sm tracking-[0.15em] mb-4 block font-medium">01 / SCHEDULE</span>
              <h3 className="text-3xl md:text-4xl text-[#002255] font-medium mb-8 leading-relaxed tracking-wide">
                計画的な学習が、<br />目標への最短距離。
              </h3>
              <p className="text-[#666666] leading-loose mb-10 text-justify font-light">
                通教生向けのスケジュールです！<br />
                見やすいなと思って貰えたらXで《いいね》や《RT》で広めて貰えると嬉しいです。
              </p>

              {/* 公式Xへのリンク */}
              <div className="space-y-4">
                <a href="https://x.com/hosei_c_media?s=20" target="_blank" rel="noopener noreferrer" className="flex items-center text-[#666666] hover:text-[#002255] transition-colors group">
                  <span className="w-8 h-[1px] bg-[#E65C00] mr-4 transition-all duration-300 group-hover:w-12"></span>
                  <span className="tracking-wide">法政通信メディア＠勉強・就職情報発信</span>
                </a>
                <a href="https://x.com/hosei_c_media2" target="_blank" rel="noopener noreferrer" className="flex items-center text-[#666666] hover:text-[#002255] transition-colors group">
                  <span className="w-8 h-[1px] bg-[#E65C00] mr-4 transition-all duration-300 group-hover:w-12"></span>
                  <span className="tracking-wide">締切リマインド＠法政通信メディア2nd</span>
                </a>
              </div>
            </motion.div>

            {/* 画像エリア */}
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="w-full md:w-7/12 z-20 relative mt-8 md:mt-0 md:-ml-12"
            >
              <div className="rounded-xl overflow-hidden border border-gray-200 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] bg-white p-2 md:p-4">
                <img
                  src="/schedule-calendar.png"
                  alt="通教生向け 年間スケジュールカレンダー"
                  className="w-full h-auto object-contain"
                />
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* セクション2: OFFICIAL X TIMELINE（更新部分） */}
      <section className="py-32 overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col md:flex-row items-center justify-between gap-12">

            {/* 左側：説明テキスト */}
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="w-full md:w-5/12 bg-[#FAFAFA] p-10 md:p-16 border border-gray-100 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)]"
            >
              <span className="text-[#E65C00] text-sm tracking-[0.15em] mb-4 block font-medium">02 / OFFICIAL X</span>
              <h3 className="text-3xl md:text-4xl text-[#002255] font-medium mb-8 leading-relaxed tracking-wide">
                最新の更新情報を、<br />リアルタイムで。
              </h3>
              <p className="text-[#666666] leading-loose mb-10 text-justify font-light">
                公式Xアカウントでは、リポートの提出締切やスクーリング情報、学習・就職活動に役立つ情報をタイムリーに投稿しています。
              </p>

              <a
                href="https://x.com/hosei_c_media"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-white bg-[#E65C00] hover:bg-[#CC5200] text-sm tracking-widest px-6 py-3 rounded-md shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 font-medium"
              >
                Xでフォローする
                <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
                </svg>
              </a>
            </motion.div>

            {/* 右側：Xタイムライン埋め込み表示 */}
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
              className="w-full md:w-6/12 z-20 relative"
            >
              <div className="bg-white rounded-2xl p-2 md:p-4 border border-gray-200 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)]">
                <XTimeline username="hosei_c_media" />
              </div>
            </motion.div>

          </div>
        </div>
      </section>

    </div>
  );
}