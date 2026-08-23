import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import XTimeline from '../components/XTimeline';

export default function Home() {
  const [keyword, setKeyword] = useState('');

  // 初期値
  const [tweetIds, setTweetIds] = useState([
    '2084907256160637081',
    '2084929908820852873'
  ]);
  const [isLoading, setIsLoading] = useState(true);

  const navigate = useNavigate();

  // スクロール設定
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, 150]);
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);

  // フォント適用
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  // 自前GAS APIから最新ツイートIDを高速・確実に取得
  useEffect(() => {
    const fetchLatestTweets = async () => {
      try {
        // ステップ2でコピーしたGASのウェブアプリURLを貼り付けてください
        const gasUrl = 'https://script.google.com/macros/s/AKfycbyyd8XGGvrbS2drulZa91kItf0xlLaDiehSfkFMshO0AsIMaHLPrKnQgMMu8ExbynVFag/exec';

        const res = await fetch(gasUrl);
        const data = await res.json();

        if (data.tweetIds && data.tweetIds.length > 0) {
          setTweetIds(data.tweetIds.slice(0, 2));
        }
      } catch (err) {
        console.error('Failed to fetch from GAS API:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLatestTweets();
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
    <div className="bg-[#FAFAFA] text-[#1A1A1A] antialiased" style={{ fontFamily: '"Noto Serif JP", serif' }}>

      {/* ヒーローセクション */}
      <header className="relative h-screen flex items-center justify-center overflow-hidden">
        <motion.div style={{ y: heroY }} className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[#002255]/40 z-10"></div>
          <img
            src="/hedda.jpeg"
            alt="法政大学イメージ"
            className="w-full h-full object-cover scale-105"
          />
        </motion.div>

        <motion.div style={{ opacity }} className="relative z-20 text-center text-white px-4 mt-20">
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

      {/* セクション2: OFFICIAL X TIMELINE */}
      <section className="py-32 overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col items-center gap-12">

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="text-center w-full"
            >
              <span className="text-[#E65C00] text-sm tracking-[0.15em] mb-4 block font-medium">02 / OFFICIAL X</span>
              <h3 className="text-3xl md:text-4xl text-[#002255] font-medium tracking-wide">
                TIMELINE
              </h3>
            </motion.div>

            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-8 z-20 relative min-h-[400px]">
              {!isLoading && tweetIds.map((id, index) => (
                <motion.div
                  key={id}
                  initial={{ opacity: 0, x: index === 0 ? -30 : 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 1, delay: 0.2 + index * 0.2, ease: "easeOut" }}
                  className="bg-[#FAFAFA] rounded-2xl p-6 border border-gray-100 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)]"
                >
                  <div className="bg-white rounded-xl p-2 border border-gray-200">
                    <XTimeline tweetId={id} />
                  </div>
                </motion.div>
              ))}
            </div>

          </div>
        </div>
      </section>

      {/* セクション3: MEMBERS */}
      <section className="py-32 bg-[#F5F5F7] overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col md:flex-row-reverse items-center justify-between gap-12">
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
              className="w-full md:w-5/12 bg-white p-10 md:p-16 relative z-10 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)]"
            >
              <span className="text-[#E65C00] text-sm tracking-[0.15em] mb-4 block font-medium">03 / MEMBERS</span>
              <h3 className="text-3xl md:text-4xl text-[#002255] font-medium mb-8 leading-relaxed tracking-wide">
                法政通信メディアの<br />運営メンバーを紹介します！
              </h3>
              <p className="text-[#666666] leading-loose mb-10 text-justify font-light">
                当サイトは、現役の通教生が自らの経験と知識を持ち寄り、学生生活をサポートするために運営しています。メンバーそれぞれの学習スタイルや目標などをご紹介します。
              </p>

              <Link
                to="/member"
                className="inline-flex items-center text-white bg-[#E65C00] hover:bg-[#CC5200] text-sm tracking-widest px-6 py-3 rounded-md shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 font-medium group"
              >
                メンバープロフィールを見る
                <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
                </svg>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="w-full md:w-6/12 z-20 relative mt-8 md:mt-0"
            >
              <div className="bg-white rounded-xl border border-gray-200 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] p-12 flex justify-center items-center gap-6">
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-[#FAFAFA] shadow-md">
                  <img src="/member-founder.jpg" alt="メンバー1" className="w-full h-full object-cover" />
                </div>
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-[#FAFAFA] shadow-md">
                  <img src="/member1.jpg" alt="メンバー2" className="w-full h-full object-cover" />
                </div>
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-[#FAFAFA] shadow-md">
                  <img src="/member2.jpg" alt="メンバー3" className="w-full h-full object-cover" />
                </div>
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-[#FAFAFA] shadow-md">
                  <img src="/member3.jpg" alt="メンバー4" className="w-full h-full object-cover" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* セクション4: MESSAGE */}
      <section className="py-32 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="w-full max-w-5xl mx-auto bg-[#FAFAFA] p-10 md:p-16 md:px-24 border-t-4 border-[#002255] shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)] relative"
          >
            <div className="absolute top-0 left-8 md:left-12 -translate-y-1/2 bg-white px-2">
              <span className="text-5xl text-[#C6A87C] font-serif leading-none">“</span>
            </div>

            <span className="text-[#E65C00] text-sm tracking-[0.15em] mb-4 block font-medium">04 / FOUNDER'S MESSAGE</span>
            <h3 className="text-2xl md:text-3xl text-[#002255] font-medium mb-8 leading-relaxed tracking-widest">
              いつか君も困っている人がいたら、<br />
              助けてあげてね。
            </h3>
            <div className="text-[#666666] leading-loose mb-10 text-justify font-light space-y-4">
              <p>
                私がこの"法政通信メディア"を立ち上げた背景にある、一つの大切な「約束」についてお話しさせてください。
              </p>
              <p>
                私の大学生活は、最初から順風満帆だったわけではありません。そんな暗闇の中にいた私に、優しさで手を差し伸べてくれた人がたくさんがいました。
              </p>
            </div>

            <div className="flex justify-start">
              <Link
                to="/message"
                className="inline-flex items-center text-white bg-[#E65C00] hover:bg-[#CC5200] text-sm tracking-widest px-6 py-3 rounded-md shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 font-medium group"
              >
                メッセージの続きを読む
                <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
                </svg>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}