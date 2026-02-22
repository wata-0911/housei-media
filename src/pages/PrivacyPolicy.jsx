export default function PrivacyPolicy() {
  return (
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-3xl text-gray-800">
      <h2 className="text-2xl md:text-3xl font-bold mb-6 text-center text-blue-800">プライバシーポリシー・免責事項</h2>

      {/* ユーザーに必ず読んでほしい重要事項をハイライト */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-5 mb-8 rounded-r-lg shadow-sm">
        <p className="font-bold text-gray-800 mb-2">【重要なお知らせ】</p>
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-2">
          当サイトは学生有志による運営であり、法政大学公式によるものではありません。
        </p>
        <p className="text-sm md:text-base text-gray-700 leading-relaxed">
          大学の情報（入試、カリキュラム、奨学金など）は頻繁に更新されます。最新情報は必ず大学公式HPを確認してください。
        </p>
      </div>

      <div className="space-y-8 bg-white p-6 md:p-8 rounded-lg shadow-sm border border-gray-100">
        
        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">1. 個人情報の利用目的</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            本サイト（以下、「当サイト」といいます）では、お問い合わせや記事へのコメントの際、名前やメールアドレス等の個人情報を入力いただく場合がございます。<br />
            取得した個人情報は、お問い合わせに対する回答や必要な情報を電子メールなどでご連絡する場合に利用させていただくものであり、これらの目的以外では利用いたしません。
          </p>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">2. AIチャット機能の利用について</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            当サイトのチャット機能は、外部のAPIを利用して回答を生成しています。入力された質問内容は、システムの品質向上のために一時的に処理されますが、個人を特定する形での学習には使用されません。個人情報や機密情報は入力しないでください。
          </p>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">3. 広告の配信について</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            当サイトは、第三者配信の広告サービス（Googleアドセンス、Amazonアソシエイト等）を利用する可能性があります。<br />
            広告配信事業者は、ユーザーの興味に応じた広告を表示するためにCookie（クッキー）を使用することがあります。これにより、当サイトはお客様のコンピュータを識別できるようになりますが、お客様個人を特定できるものではありません。Cookieを無効にする方法やGoogleアドセンスに関する詳細は「Googleポリシーと規約」をご覧ください。
          </p>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">4. アクセス解析ツールについて</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            当サイトでは、Googleによるアクセス解析ツール「Googleアナリティクス」を利用しています。このGoogleアナリティクスはトラフィックデータの収集のためにクッキー（Cookie）を使用しております。トラフィックデータは匿名で収集されており、個人を特定するものではありません。
          </p>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">5. 個人情報の第三者への開示</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed mb-2">
            当サイトでは、個人情報は適切に管理し、以下に該当する場合を除いて第三者に開示することはありません。
          </p>
          <ul className="list-disc ml-6 text-sm md:text-base text-gray-600 space-y-1">
            <li>本人のご了解がある場合</li>
            <li>法令等への協力のため、開示が必要となる場合</li>
          </ul>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">6. 免責事項</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed mb-2">
            当サイトに掲載されている情報やAIの回答は正確を期していますが、大学の公式見解ではありません。履修登録や単位修得に関する最終的な確認は、必ず大学発行の公式シラバスや履修要項で行ってください。
          </p>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed mb-2">
            当サイトのコンテンツ・情報について、可能な限り正確な情報を掲載するよう努めておりますが、情報の正確性や安全性を保証するものではありません。当サイトに掲載された内容によって生じた損害等の一切の責任を負いかねますのでご了承ください。
          </p>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            また、当サイトからリンクやバナーなどによって他のサイトに移動された場合、移動先サイトで提供される情報、サービス等について一切の責任を負いません。
          </p>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">7. 著作権・肖像権について</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            当サイトで掲載している文章や画像などにつきましては、無断転載を禁止します。<br />
            当サイトは著作権や肖像権の侵害を目的としたものではありません。著作権や肖像権に関して問題がございましたら、お問い合わせフォームよりご連絡ください。迅速に対応いたします。
          </p>
        </section>

        <section>
          <h3 className="text-lg md:text-xl font-bold border-b-2 border-blue-100 pb-2 mb-3">8. 本ポリシーの変更</h3>
          <p className="text-sm md:text-base text-gray-600 leading-relaxed">
            当サイトは、個人情報に関して適用される日本の法令を遵守するとともに、本ポリシーの内容を適宜見直しその改善に努めます。修正された最新のプライバシーポリシーは常に本ページにて開示されます。
          </p>
        </section>

      </div>
    </div>
  );
}