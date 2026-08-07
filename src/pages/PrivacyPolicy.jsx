import { useEffect } from 'react';
import { motion } from 'framer-motion';

export default function PrivacyPolicy() {
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
            LEGAL
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl md:text-5xl font-light tracking-wider"
          >
            プライバシーポリシー・免責事項
          </motion.h2>
        </div>
      </section>

      {/* コンテンツセクション */}
      <section className="py-20 md:py-32">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="bg-white p-8 md:p-16 relative z-20 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.08)] border-t-4 border-[#002255]"
          >

            {/* 重要なお知らせ（アラートブロックのエレガント化） */}
            <div className="bg-[#F5F5F7] border-l-4 border-[#E65C00] p-6 mb-16">
              <p className="font-medium text-[#002255] mb-3 tracking-wide">【重要なお知らせ】</p>
              <p className="text-sm md:text-base text-[#666666] leading-relaxed mb-2 font-light">
                当サイトは学生有志による運営であり、法政大学公式によるものではありません。
              </p>
              <p className="text-sm md:text-base text-[#666666] leading-relaxed font-light">
                大学の情報（入試、カリキュラム、奨学金など）は頻繁に更新されます。最新情報は必ず大学公式HPを確認してください。
              </p>
            </div>

            <div className="space-y-16">

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  1. 個人情報の利用目的
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                  本サイト（以下、「当サイト」といいます）では、お問い合わせや記事へのコメントの際、名前やメールアドレス等の個人情報を入力いただく場合がございます。<br />
                  取得した個人情報は、お問い合わせに対する回答や必要な情報を電子メールなどでご連絡する場合に利用させていただくものであり、これらの目的以外では利用いたしません。
                </p>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  2. アクセス解析ツールについて
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                  当サイトでは、Googleによるアクセス解析ツール「Googleアナリティクス」を利用しています。このGoogleアナリティクスはトラフィックデータの収集のためにクッキー（Cookie）を使用しております。トラフィックデータは匿名で収集されており、個人を特定するものではありません。
                </p>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  3. 個人情報の第三者への開示
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify mb-4">
                  当サイトでは、個人情報は適切に管理し、以下に該当する場合を除いて第三者に開示することはありません。
                </p>
                <ul className="list-none ml-2 text-[#4A4A4A] leading-loose text-sm md:text-base font-light space-y-2">
                  <li className="flex items-start">
                    <span className="text-[#E65C00] mr-3 font-bold">―</span>
                    本人のご了解がある場合
                  </li>
                  <li className="flex items-start">
                    <span className="text-[#E65C00] mr-3 font-bold">―</span>
                    法令等への協力のため、開示が必要となる場合
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  4. 免責事項
                </h3>
                <div className="space-y-4">
                  <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                    履修登録や単位修得に関する最終的な確認は、必ず大学発行の公式シラバスや履修要項で行ってください。
                  </p>
                  <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                    当サイトのコンテンツ・情報について、可能な限り正確な情報を掲載するよう努めておりますが、情報の正確性や安全性を保証するものではありません。当サイトに掲載された内容によって生じた損害等の一切の責任を負いかねますのでご了承ください。
                  </p>
                  <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                    また、当サイトからリンクやバナーなどによって他のサイトに移動された場合、移動先サイトで提供される情報、サービス等について一切の責任を負いません。
                  </p>
                </div>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  5. 著作権・肖像権について
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                  当サイトで掲載している文章や画像などにつきましては、無断転載を禁止します。<br />
                  当サイトは著作権や肖像権の侵害を目的としたものではありません。著作権や肖像権に関して問題がございましたら、お問い合わせフォームよりご連絡ください。迅速に対応いたします。
                </p>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  6. 本ポリシーの変更
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                  当サイトは、個人情報に関して適用される日本の法令を遵守するとともに、本ポリシーの内容を適宜見直しその改善に努めます。修正された最新のプライバシーポリシーは常に本ページにて開示されます。
                </p>
              </section>

            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}