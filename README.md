# 法政通信メディア

法政大学通信教育部の学生向けに、勉強、単位修得、試験、スクーリング、就職、学生生活などの情報を提供するサイトです。現役学生が自らの経験と知識を持ち寄って運営しています。

**学生有志による非公式サイトであり、法政大学の公式サイトではありません。**

## 公開サイト

[https://hosei-tsukyo-media.com/](https://hosei-tsukyo-media.com/)

## 主な機能

| ページ | パス | 内容 |
|---|---|---|
| トップ | `/` | サイト紹介、年間スケジュール画像、Q&A検索への導線、X投稿、各ページへの案内 |
| Q&A | `/qa` | 質問・回答・カテゴリを対象にしたキーワード検索、カテゴリ別表示、回答の開閉 |
| お問い合わせ | `/contact` | Google Apps Script（GAS）経由の送信、送信結果の案内 |
| 運営メンバー | `/member` | メンバーを切り替えてプロフィールを表示 |
| 創立者メッセージ | `/message` | 設立の背景と活動への想い |
| プライバシーポリシー | `/privacy` | 個人情報の取り扱い、免責事項など |
| 404 | その他のパス | ページが見つからない旨とトップページへのリンク |

- Q&A検索はURLクエリ `q` と同期し、検索結果のURL共有や再読み込みに対応します。トップとヘッダーからも検索できます。
- Xの最新投稿IDをGASから取得し、固定投稿とともに表示します。取得中・取得失敗時は設定済みの投稿IDを使用します。埋め込みエラーを検出すると「Xでこのポストを見る」リンクを表示します。
- お問い合わせはHTTPステータスとJSONの構造を検証し、10秒でタイムアウトします。タイムアウト時は失敗と断定せず、自動返信メールの確認を案内します。
- `src/App.tsx` でページごとの `title`・`description` と、パスに応じた `canonical` をブラウザ上で更新します。検索クエリはcanonicalに含めません。

## 技術構成

ReactとTypeScriptによるSPAです。以下は `package-lock.json` に記録されたバージョンです。依存更新時はlockfileを確認してください。

| 技術 | バージョン | 用途 |
|---|---|---|
| React / React DOM | 19.2.4 | UI・描画 |
| TypeScript | 5.9.3 | 型チェック（`strict: true`） |
| Vite | 7.3.6 | 開発サーバー・ビルド |
| React Router DOM | 7.18.4 | `BrowserRouter` によるページ遷移・検索クエリ管理 |
| Tailwind CSS | 3.4.17 | スタイリング（PostCSS・Autoprefixer経由） |
| Framer Motion | 12.38.0 | アニメーション |
| ESLint | 9.39.2 | TypeScript・React・Hooksの静的検査 |

品質チェックにはGitHub Actions、ホスティングにはVercelを使用しています。GASとX Widgetsは外部サービスとして利用します。

## ディレクトリ構成

```text
.github/workflows/ci.yml  # 型チェック・Lint・ビルド
public/                  # カレンダー・プロフィールなどの画像
src/
  components/            # Header、Footer、XTimeline
  pages/                 # 各ページとメンバーページ用CSS
  data/qaData.ts         # 型付きQ&Aデータ
  assets/                # ソース側のアセット
  App.tsx                # ルーティング・メタ情報
  main.tsx               # エントリーポイント
  index.css              # Tailwind CSSの読み込み
index.html               # HTML・初期メタ情報・外部リソース
vercel.json              # SPAのリライト設定
```

## ローカル開発

Node.js 22系とnpmを用意してください。CIもNode.js 22系を使用しています。

```bash
git clone https://github.com/wata-0911/housei-media.git
cd housei-media
npm install
npm run dev
```

起動後、ターミナルに表示されるローカルURLを開きます。lockfileどおりに依存を導入する場合は、`npm install` の代わりに `npm ci` を使用してください。現在、フロントエンドの起動に必須の環境変数設定はありません。

ローカルでも外部サービスへ接続します。お問い合わせの送信は実サービスに届くため、動作確認時は送信先とテスト方法を運営者と確認してください。

## 品質チェック

```bash
npm run typecheck
npm run lint
npm run build
```

`build` はViteのビルドのみで、型チェックは別コマンドです。ビルド結果は `dist/` に出力され、`npm run preview` で確認できます。

[GitHub Actions](.github/workflows/ci.yml)では、**mainへのpushとmainを対象とするPR**で `npm ci` の後に上記3つの検査を実行します。現在、単体テスト・E2Eテストのコマンドはありません。

## 外部サービス

| サービス | 用途 |
|---|---|
| Google Apps Script | 最新X投稿IDの取得、お問い合わせの送信先 |
| X Widgets | 投稿の埋め込み表示 |
| Vercel | サイトのホスティング・GitHub連携デプロイ |
| Google Analytics / Google Fonts | アクセス解析 / Webフォントの配信 |

GAS側の実装・設定はこのリポジトリに含まれません。引き継ぎ時は管理権限・送信先・自動返信の設定を別途確認してください。GASの実URL、APIキー、秘密情報、個人情報はREADMEに記載しません。

通信を中断してもGAS側の処理が完了している可能性があります。問い合わせのタイムアウト時は、再送する前に自動返信メールを確認してください。

## Q&Aデータとコンテンツ更新

Q&Aは [src/data/qaData.ts](src/data/qaData.ts) の `qaData` で管理します。

| 項目 | 型 | 内容 |
|---|---|---|
| `id` | `string` | 各Q&Aの安定した一意のID。表示時のReactキーにも使用 |
| `category` | `string`（省略可） | 分類。未指定・空文字の場合は「その他」 |
| `question` | `string` | 質問文 |
| `answer` | `string` | 回答文 |

追加時は既存と重複しないIDを付け、文言修正や並べ替えだけでIDを変更しないでください。回答中の改行は表示に反映されます。変更後は品質チェックと検索・カテゴリ表示を確認してください。

年間スケジュール画像は `public/schedule-calendar.png`、メンバーデータは `src/pages/member.tsx`、各ページのメタ情報は `src/App.tsx` で更新します。

## デプロイ

mainのコミットにVercelのデプロイ成功ステータスが付いており、GitHub連携を確認できます。[vercel.json](vercel.json) はSPAの各パスを `/index.html` にリライトします。

mainへpushした後は、GitHub Actionsの検査結果とVercelのデプロイ結果をそれぞれ確認し、公開サイトの主要ページを確認してください。CI定義にはデプロイ処理がなく、CI成功がVercel公開の必須条件かどうかはリポジトリからは確認できません。本番ブランチや公開ドメインの割り当てはVercel側の設定を確認してください。

404ページはクライアント側の表示です。HTTPステータス404を返す設定は、このリライト設定には含まれません。

## 今後の改善

- Q&Aに `sourceUrl`・`lastReviewedAt` などを追加し、出典と更新日を管理する
- 画像・faviconの軽量化と、画面下部の画像の遅延読み込み
- 検索のURL同期や外部通信の失敗を検証する回帰テストの追加

## 注意事項

当サイトは非公式の学生向け情報サイトです。掲載情報の正確性・最新性を保証するものではありません。履修、試験、卒業要件などの最終確認は、大学公式サイト、シラバス、履修要項などの公式情報を参照してください。
