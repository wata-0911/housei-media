import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useReducedMotion, motion } from 'framer-motion';

export default function PrivacyPolicy() {
  const shouldReduceMotion = useReducedMotion();
  const { hash } = useLocation();
  const guideHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (hash === '#planner-guide') guideHeading.current?.focus();
  }, [hash]);

  return (
    <div className="bg-[#FAFAFA] text-[#1A1A1A] min-h-screen antialiased" style={{ fontFamily: '"Noto Serif JP", serif' }}>

      {/* ヒーローセクション */}
      <section className="bg-[#002255] text-white py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.span
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="block text-[#E65C00] text-sm tracking-[0.2em] font-medium mb-4"
          >
            LEGAL
          </motion.span>
          <motion.h2
            initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldReduceMotion ? { duration: 0, delay: 0 } : { delay: 0.1 }}
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
            initial={shouldReduceMotion ? false : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldReduceMotion ? { duration: 0, delay: 0 } : { duration: 0.8, ease: "easeOut" }}
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
                  お問い合わせフォームは、名前、メールアドレス、お問い合わせ内容をGoogle Apps Scriptへ送信します。運営メンバーは、お問い合わせへの回答や必要な連絡にこれらの情報を利用します。成績ファイルや大学のログイン情報など、回答に不要な情報は送らないでください。
                </p>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  2. アクセス解析ツールについて
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify">
                  法政通信メディアの本体サイトでは、サイトの利用状況の把握や改善のためにGoogle Analyticsを利用します。閲覧したページ、Cookie等の識別子、端末・ブラウザに関する情報、IPアドレス等の通信情報がGoogleに送信・処理される場合があります。文字表示にGoogle Fonts、投稿表示にXの埋め込み機能、一部のページの背景に外部配信画像を利用します。
                </p>
                <p className="mt-4 text-sm md:text-base leading-loose text-[#4A4A4A]">
                  Googleによる情報の取扱いと利用者が選べる設定については、<a href="https://policies.google.com/technologies/partner-sites?hl=ja" className="underline">Googleの案内</a>をご覧ください。
                </p>
              </section>

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  3. 個人情報の第三者への開示
                </h3>
                <p className="text-[#4A4A4A] leading-loose text-sm md:text-base font-light text-justify mb-4">
                  運営メンバーが取り扱う個人情報について、以下に該当する場合を除き、案内した利用目的の範囲を超えて第三者に提供しません。閲覧やフォーム送信に伴い外部サービスに伝わる情報は、前の節で説明しています。
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

              <section>
                <h3 className="text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 flex items-center tracking-wide">
                  <span className="w-1.5 h-6 bg-[#E65C00] mr-4 inline-block"></span>
                  7. 履修プランナーのデータ
                </h3>
                <div className="space-y-4 text-sm md:text-base leading-loose text-[#4A4A4A]">
                  <p>履修プランナーは、計画や進捗の表示・編集・保存のために、科目名、履修予定、単位、評価、成績表の科目行、進捗、所属の設定などを扱います。成績取得の補助機能は、利用者が大学のWeb学習サービスで開いた成績表の科目行を読み取ります。大学ID・学籍番号・氏名は成績の保存項目に含めていません。自由記述や原文の保護ファイルには、個人情報が含まれる場合があります。</p>
                  <p>2026年度版の公開予定先は、法政通信メディアと同じサイト内の /planner です。履修記録の保存には、ご利用のブラウザの保存領域を使います。パスを切り替えても同じサイトの保存領域は共有されます。旧版からの記録の持ち込みや復元には、対応するファイルの選択と利用者による確認が必要です。</p>
                  <p>書き出したJSONには成績や本人の履修記録が含まれる場合があります。アプリ独自の暗号化は施していません。共有端末、クリップボード、ファイルの保存先にご注意ください。ブラウザのサイトデータを削除すると、同じサイト内の保存内容を失うことがあります。必要なデータは先にバックアップし、書き出したファイルは保存先で管理してください。</p>
                  <p>個人情報の取扱いについては、<a href="/contact" className="underline">お問い合わせフォーム</a>から運営メンバーへご連絡ください。</p>
                </div>
              </section>

              <section aria-labelledby="planner-guide">
                <h3 id="planner-guide" ref={guideHeading} tabIndex={-1} className="scroll-mt-32 text-xl md:text-2xl text-[#002255] font-medium border-b border-[#C6A87C] pb-4 mb-6 tracking-wide">
                  成績取込・バックアップの使い方
                </h3>
                <ol className="list-decimal pl-5 space-y-3 text-sm md:text-base leading-loose text-[#4A4A4A]">
                  <li>大学のWeb学習サービスで成績表を開き、プランナーの案内に従って成績JSONを取得します。プレビューで取り込む内容を確認し、ご自身で反映します。</li>
                  <li>バックアップや復元は、画面に表示される対応形式をご確認ください。成績取込JSON、全データのバックアップ、原文を保全するファイルは用途が異なります。</li>
                  <li>復元前に現在の記録をバックアップします。画面から求められた場合は、復元前の保護ファイルを保存して同じファイルを再選択します。置き換わる内容を確認し、進める場合だけ確定してください。</li>
                </ol>
                <p className="mt-4 text-sm md:text-base leading-loose text-[#4A4A4A]">読み込みや保存が保留されたときは、元のファイルとブラウザのサイトデータを残し、画面の案内を確認してください。</p>
              </section>

            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
