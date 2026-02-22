import { Link } from 'react-router-dom';

export default function Members() {
  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-lg shadow-md">
        
        <h2 className="text-2xl md:text-3xl font-bold mb-6 text-center text-blue-800 border-b-2 border-blue-100 pb-4">
          運営メンバー募集
        </h2>
        
        <div className="mb-10 text-gray-700 leading-relaxed">
          <p className="mb-4">
            法政通信メディアは、通信教育課程で学ぶ学生の「情報格差」をなくし、より充実した学生生活を送るためのサポートを目的としたプラットフォームです。
          </p>
          <p>
            現在、メディアをさらに拡大し、多くの学生に価値を届けるための初期メンバー（コアメンバー）を募集しています。私たちと一緒に、ゼロからサービスを作り上げる経験をしませんか？
          </p>
        </div>

        <h3 className="text-xl font-bold mb-4 text-gray-800">募集中のポジション</h3>
        
        <div className="space-y-6 mb-10">
          
          <div className="border border-gray-200 p-5 rounded-md bg-gray-50">
            <h4 className="font-bold text-lg text-blue-700 mb-2">1. 記事ライター・編集担当</h4>
            <p className="text-sm text-gray-600">
              学習のコツ、単位取得のアドバイス、スクーリングの体験談などの記事執筆・編集をお願いします。文章を書くのが好きな方、自分の経験を後輩に伝えたい方に最適です。
            </p>
          </div>

          <div className="border border-gray-200 p-5 rounded-md bg-gray-50">
            <h4 className="font-bold text-lg text-blue-700 mb-2">2. SNSマーケティング・広報</h4>
            <p className="text-sm text-gray-600">
              X(Twitter)等の公式アカウント運用、企画の立案、フォロワー獲得のための戦略実行をお願いします。マーケティングの実務経験を積みたい方を歓迎します。
            </p>
          </div>

          <div className="border border-gray-200 p-5 rounded-md bg-gray-50">
            <h4 className="font-bold text-lg text-blue-700 mb-2">3. エンジニア・デザイナー</h4>
            <p className="text-sm text-gray-600">
              Reactを用いたサイトの機能追加（AI機能の拡張など）や、見やすいUI/UXの設計をお願いします。プログラミングやデザインのポートフォリオを作りたい方におすすめです。
            </p>
          </div>

        </div>

        <div className="text-center">
          <p className="mb-6 text-sm text-gray-600">
            少しでも興味を持ってくださった方は、まずはカジュアルにお話ししましょう！<br />
            以下のボタンからお問い合わせフォームへ進み、「メンバー募集について」と記載してご連絡ください。
          </p>
          <Link 
            to="/contact" 
            className="inline-block bg-blue-800 text-white font-bold py-3 px-8 rounded-full hover:bg-blue-700 transition shadow-md"
          >
            応募・話を聞いてみる
          </Link>
        </div>

      </div>
    </div>
  );
}