# Plannerの通常CIと配信入力

GitHub ActionsのCIはmain宛ての通常pull_requestとmainへのpushで実行する。Node 22と24の両ジョブで成功したときだけ、従来のチェック名 check が成功する。PRの取得に使う資格情報はcheckoutへ保存せず、権限はcontents: read。ジョブは配信API、サイト資格情報、リポジトリSecretsを使わない。

| コマンド | 確認内容 |
| --- | --- |
| npm ci | lockfileから依存を入れる。Node 22または24 |
| npm run test:planner | test:planner:integrationからリポジトリ内29件、移設した保存5件、検索由来・成績取込由来の旧dev引継ぎと互換を実行 |
| npm run typecheck / npm run lint | 全体の型検査と既定lint |
| npm run build | カタログと成績取込の生成物を照合し、通常Vite build |
| npx --no-install playwright-core install --with-deps --no-shell chromium | lockfileに固定したChromiumをUbuntuランナーへ準備 |
| npm run test:planner:browser -- /new/evidence-directory | 390px、1280pxの各6条件を実行。固定dev、staging編集ON/OFF、本番想定編集ON/OFF、合成広告 |

保存5件は tests/planner-release-persistence.test.mjs。Stage69 tree 9edf02888414c51262142931db5788e116dcd391 の旧v2正本モジュール（blob f36e122670a1046c35e0b0488f1f61eb2aa74ea0）の原文を固定している。試験時にこのcheckoutの共通Plannerヘルパーへ解決し、旧v2の生成・再読込とv3からの書込拒否を同じ合成ストレージで検証する。以前のcheckoutや完全な旧環境の復元は不要。その他のケースは旧可搬、照合、単位確定と不明、年度とUUIDの保持、同一開講の自動と手動の切替。

ブラウザのdev比較では公開GitHubの ae59d713f63dd895b66c2acbefdf1850e22d6342 とtree 90038dfa982b2da211b901a803d82a887868498a を準備時に照合し、別の一時領域でlockfileからbuildする。Stage73のルートJSON・既存画像のSHAには合成用の保護境界だけを含む。これらのSHAと旧v2原文のSHAは tests/fixtures/planner-release/SHA256SUMS にある。プライベートDriveや作業機の絶対パスは不要。

ブラウザ起動前の依存準備はGitHubと通常の公開パッケージ配布元を使用する。シナリオ開始後は各対象ホストを127.0.0.1の一時ポートに固定し、他の名前解決を拒否する。Playwrightも合成テストの許可originだけを通し、GA/X/GAS等は遮断またはスタブで返す。ローカル生成の短期TLS証明書だけを使用する。本番や保護staging、広告提供元にアクセスせず、実成績を使わない。必要な参照、ブラウザ、環境が欠ければジョブは失敗する。 [Playwrightのブラウザ準備](https://playwright.dev/docs/browsers) · [Chromiumのホストとポートの固定方法](https://chromium.googlesource.com/chromium/src/+/main/net/base/host_mapping_rules.h)

## 旧dev通常バックアップからの進捗引継ぎ

原本を保護付きで復元した後、履修中の本人計画、同一Offering、確定した年度、旧進捗が一意に揃う場合だけ、メディア画面に確認を表示する。承認するまで旧進捗は閲覧のみ。引継ぎ時は同じWeb Lock内で世代、A・P/R原文、履修回、確認済みの元進捗を再照合し、元の動画・テスト・評価予定を新しい本人進捗UUIDに複製する。

旧原文はAのprimaryRawにそのまま残る。確認済みの引継ぎは同一キーにv4として保存し、以後はそのUUIDの進捗だけを更新する。可搬v4バックアップは受け側のv4対応版で保護付き復元する。v2/v3を開くだけでは更新しない。確認済みv4を以前の保存形式で置換できない。古いタブと旧readerの編集は保存の比較・形式検査で拒否する。切戻しではv4正本と可搬バックアップを保持し、書込みを再開する場合はv4対応版に戻す。

監査と同一の合成バックアップをテストに収録した。tests/fixtures/planner-release/ordinary-dev.json.gzを展開したSHA256は 55dbb1ff7dc5d0adcb8136ce7572be53d7559e22aa65ce2d867b9b0460848648。ブラウザでは編集ONの4条件で保護復元、明示確認と取消、1/14から2/14への編集・再読込、v4のバックアップ往復、改変された保護ファイルの拒否を検査する。

### 成績取込に由来する旧進捗

同じ旧Offeringに対応する公式原行と本人詳細回が各1件で、元の年度・期・開講IDと本人の履修中状態を確認できるときは、同じ画面から本人詳細回へ引き継げる。名前では照合しない。競合・確認前・別の進捗が既にある場合は元の記録を表示して保留し、新しい入力欄から同じ旧進捗を分岐させない。

確認済みの取込由来の引継ぎにはv5を使う。v4は検索由来のOffering Trackの原文照合を定め、独立した詳細回Trackでは同じ項目を許さない。v5は旧Offeringと元進捗、公式原行・詳細回の根拠を別の明示項目に保存する。v2/v3/v4の表現と復元経路を維持し、起動や通常復元でv5に更新しない。いずれの引継ぎも確定時に元の進捗全体を複製し、A.primaryRaw、旧P/R、公式原行・詳細回IDを更新しない。既存の検索v4 Trackは取込v5と共存できる。

可搬v5を復元する際は元進捗と公式原行・詳細回・開講を内容から再照合する。再計算したSHAだけでは意味不整合を受け付けない。古いv3/v4 readerは版を拒否し、開き済みの古いwriterはCASで拒否する。切戻しではv5原本と可搬バックアップを保持し、書込みを再開する場合はv5対応版へ戻す。旧版にv5を開かせたり、旧形式でv5を上書きしたりしない。

tests/fixtures/planner-release/ordinary-dev-import.json.gz は監査原本を無編集で圧縮した合成入力。展開後SHA256は 703d3cfc72af2bc8a0d5fac2903fc7b5c814608c9536072655af244b107a900a。ブラウザの編集ON四条件では、動画第1回を引き継いで第2回のテストだけを追加し、再読込・可搬復元後の同じUUIDに両方があることを検査する。

親の既存Planner iframeから、確定した子オリジンにだけ focus-without-user-activation を許可する。Home導線は子の目的のセクションに実際にフォーカスしたことを検査する。 [HTML標準のフォーカス条件](https://html.spec.whatwg.org/multipage/interaction.html#allow-focus-steps)

## 配信入力の生成

npm run build:planner:release -- /new/output-directory で、production-off/parent、production-off/child、staging-on、staging-off と全収録ファイルの SHA256SUMS を生成する。出力先は新規ディレクトリを指定。通常の npm run build とは別の構成で、stagingだけでGA初期化を除去し、保護境界のルートを固定参照と照合する。production-onと合成広告はブラウザ試験の作業領域にだけ生成する。

- 本番親は main-planner-parent のindex.html。親の https://hosei-tsukyo-media.com/planner と /planner/ は、生成構成の限定ルートからこのindex.htmlを開く。
- 本番子は main-planner-child の静的出力。予定URLは https://planner.hosei-tsukyo-media.com/child 。このホスト専用の生成配置に子のみを入れる。既定は編集OFF。
- リポジトリルートのvercel.jsonは既存の /planner → /planner.html を保持する。生成した production-off/parent/vercel.json は親indexを返す別の構成。mainマージだけでは公開されず、親の実プロジェクトの入力と子DNS/TLS/domain/SSOに別承認が要る。
- 子の予定domainは既存のprj_J3HhUwPF28zjmMvU7puZkUmFGn7Bに未登録という管理情報。子SSO allの変更は対象外。AdSenseの設定、実素材とタグは対象外。

## PRブランチの配信抑止と切戻し

git.deploymentEnabled は feature/planner-2026-stage29-20261118 のみfalse。これはGit連携プロジェクトが実効ルートでこの設定を読む場合の抑止。main/devや他ブランチの既定に影響させず、Webhookや別の配信経路の停止までは示さない。push前に全連携プロジェクトの実効ルートと他経路を確認する。 [Vercel Git設定](https://vercel.com/docs/project-configuration/git-configuration)

切戻しは別承認で行う。親と子の既存配信ID、生成設定と入力SHAを先に控え、先に親の旧入口へ戻す。子の保存originと保存領域は保持する。v3を使った記録は対応版で可搬バックアップを退避し、v2コードにv3の上書きをさせない。SSOや配信切替だけでは既に開いている編集タブの停止を保証しない。
