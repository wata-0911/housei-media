import { useEffect } from 'react';
import { motion } from 'framer-motion';

export default function Message() {
  // Noto Serif JPフォントを適用
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  return (
    <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen antialiased" style={{ fontFamily: '"Noto Serif JP", serif' }}>

      {/* ヒーローセクション */}
      <section className="bg-[#002255] text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="block text-[#E65C00] text-sm tracking-[0.2em] font-medium mb-4"
          >
            MESSAGE
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl md:text-5xl font-light tracking-wider"
          >
            創立者からのメッセージ
          </motion.h2>
        </div>
      </section>

      {/* メッセージ本文（手紙・コラム風レイアウト） */}
      <section className="py-20 md:py-32">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="bg-white p-10 md:p-20 relative z-20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.08)] border-t-4 border-[#002255]"
          >
            {/* 装飾：引用符 */}
            <div className="absolute top-0 left-10 md:left-16 -translate-y-1/2 bg-[#FAFAFA] px-4">
              <span className="text-6xl text-[#C6A87C] font-serif leading-none">“</span>
            </div>

            <h3 className="text-2xl md:text-3xl text-[#002255] font-medium mb-12 text-center tracking-widest leading-relaxed">
              いつか君も困っている人がいたら、<br className="hidden md:block" />
              助けてあげてね。
            </h3>

            <div className="text-[#4A4A4A] leading-[2.2] tracking-wide text-sm md:text-base font-light space-y-8 text-justify">
              <p>
                卒業を迎えるにあたり、私がこの"法政通信メディア"を立ち上げた背景にある、一つの大切な「約束」についてお話しさせてください。
              </p>

              <p>
                私の大学生活は、最初から順風満帆だったわけではありません。無駄に大きい設題総覧や学習のしおりを頑張って読み込むも勘違いをしてミスの連発もありましたし、スクーリングではどう振る舞えばいいのか分からず、一人で途方に暮れていた時期もありました。
              </p>

              <p>
                そんな暗闇の中にいた私に、優しさで手を差し伸べてくれた人がたくさんがいました。そんな方々に助けられ、ようやく前を向くことができた時、とある人の去り際に掛けられた言葉が今も忘れられません。
              </p>

              <p className="text-[#002255] font-medium text-center text-lg md:text-xl my-12 tracking-widest bg-gray-50 py-6 rounded-sm border-y border-gray-100">
                「いつか君も困っている人がいたら、助けてあげてね」
              </p>

              <p>
                その一言が、私の心に深く根を張りました。自分が受けた恩を、ただ受け取るだけで終わらせたくない。その想いが形を変え、「情報発信」という手段で学生たちの力になるメディアの創設へと繋がりました。
              </p>

              <p>
                このアカウントは、誰かの「困った」を「良かった」に変えるために存在しています。私がかつて救われたように、この活動が誰かの前を向く希望になることを願ってきました。
              </p>

              <p className="font-medium text-[#1A1A1A]">
                このバトンを後輩の皆さんに託します。
              </p>

              <p>
                手法や形は変わってもいい。けれど、根底にある「誰かのために」という温かな精神だけは、どうか忘れずに引き継いでいってほしいと思います。この活動が、これからも多くの学生を支える力になることを心から応援しています！
              </p>
            </div>

            {/* 装飾：右下のアクセント */}
            <div className="mt-16 text-right">
              <span className="inline-block w-12 h-[1px] bg-[#E65C00] mb-4"></span>
              <p className="text-[#002255] tracking-[0.2em] text-sm font-medium">法政通信メディア 創立者</p>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}