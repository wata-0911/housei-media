# Issue #165: アニメーション調査と検証

基準はPR #184マージ済みのdev `e390af447e12151e968ec0f7337dbcc9fb60cbf6`。
実装担当者の自己検証であり、別セッションによる独立監査ではない。

## 調査結果

`src` 全体のFramer Motion、CSS transition/animation、transform、スクロールAPI、繰り返し処理を確認した。

| 対象 | 既存の表現 | 今回の対応 |
| --- | --- | --- |
| Home | 見出し・本文のフェード/縦移動、スクロールで表示する左右/縦移動、時間差表示 | reduced-motion時は `initial={false}`、明示transitionのduration/delayを0にする |
| Home | スクロール連動の背景移動・文字の透明化、SCROLLの反復上下移動 | 既存の `useReducedMotion` 分岐で対応済み。変更しない |
| Home | CTAのhover時の浮き上がり・矢印移動、Xリンクの線幅拡大 | `motion-reduce` variantで移動・幅変更を抑制 |
| Q&A | 見出し・検索・カテゴリのフェード/縦移動、画面内に入ったカテゴリの登場 | 初期の非表示/移動と明示transitionを抑制 |
| Q&A | 検索focus・カテゴリ色・カード影・開閉矢印回転のtransition | 共通CSSでtransitionを無効化。開閉状態を表す矢印の最終向きは即時反映 |
| お問い合わせ | 見出し・フォームのフェード/縦移動、送信ボタンのtap時縮小 | 初期の非表示/移動、明示transition、tap時縮小を抑制 |
| お問い合わせ | input/textareaのfocus、ボタンの色・影transition | 共通CSSで無効化。送信中の文字・disabledと失敗alertは維持 |
| 履修プランナー | タイトル・単位サマリーの登場/時間差表示 | 初期の非表示/移動と明示transitionを抑制。状態・イベント・計算処理は変更しない |
| Planner操作ボタン（#173） | 色200ms transition | #184で対応済み。既存の `.planner-button` reduced-motionルールを変更しない |
| 創立者メッセージ・プライバシーポリシー | 見出し・本文のフェード/縦移動 | 初期の非表示/移動と明示transitionを抑制 |
| 運営メンバー | AnimatePresenceの退出/登場（フェード・縦移動）、選択ボタンのtransition | 初期の非表示/移動を抑制、退出はopacity 1/y 0、duration/delay 0。CSSも即時切り替え |
| Header・Footer・PageEdgeNavigation・XTimeline・404 | リンク/ボタンの色などのtransition | 使用中のTailwind transitionクラスを共通CSSで無効化 |
| ページ端ナビゲーション | smoothスクロール | 操作時にmatchMediaを確認しreduce時はinstant。既存対応済みで変更しない |
| ページ遷移・Plannerプロフィールへの移動 | scrollTo/scrollIntoView | smooth指定なし。追加変更不要 |
| カレンダー承認 | 認証/読み込み/エラーを文字表示 | 自前のアニメーションなし。変更不要 |
| `src/App.css` | Vite初期テンプレートのlogo transition/反復回転 | どこからもimportされていない。回転自体もno-preference限定。変更不要 |

画像の固定scaleや中央配置のtranslateはアニメーションではなくレイアウトなので維持した。
X埋め込みiframe内部は外部サービス管理で、親ページからCSS/Motion設定を適用できない。
状態表示用の独自spinnerやCSS keyframeアニメーションは現在の有効なソースにはない。

## 方針と通常設定の保全

Framer Motionの既存API `useReducedMotion` を各対象ページで使用し、既存Homeと同じ分岐方針に合わせた。
フェードも装飾目的のため、reduce時は待たずに表示する。画面外の要素も非表示の初期状態を持たず、
IntersectionObserverの発火を待たなくても読める。退出はゼロ時間で完了し、次のメンバーを表示する。

共通CSSは現在使用中の `.transition-all` / `.transition-colors` / `.transition-transform` / `.select-btn` に限定する。
全要素のtransformやanimationを強制上書きしない。#173の既存ルールは維持する。

通常設定のduration/delay/ease/viewport/animate/exitはそのまま残した。
通常分岐を選び、追加したhook/importとreduce専用classを除いてTypeScript ASTで比較すると、変更した7 TSXは基準devと一致する。
CSS追加はreduceメディアクエリ内のみ。新しい演出・ライブラリ・ドメイン処理の変更はない。

## 局所ブラウザ検証

既存テストと同じ外部Playwright指定方式で実行する。package.json/lockfileの変更は不要。

```sh
PLANNER_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PLANNER_BROWSER_EXECUTABLE=/path/to/chromium \
PLANNER_SCREENSHOT_DIR=/path/to/evidence \
node --test tests/reduced-motion.browser.mjs
```

`PLANNER_BROWSER_PORT` は省略時4185。スクリーンショット出力は任意。

- Chromium、1440×1000と390×844（タッチ）、それぞれno-preference/reduceの4条件。
- Home、Q&A、お問い合わせ、Planner、メッセージ、プライバシー、メンバー、カレンダー承認、404を確認。
- CSS transition、reduce時の表示残り、横はみ出し、Homeパララックス/hover/線幅、Q&A検索・開閉、Plannerタブ、#173、ページ端のinstantスクロール、メンバー退出後の表示を確認。
- 問い合わせは外部送信を遮断し、mock応答で送信中文字・disabledと失敗alertを確認。Xなどの外部通信も遮断。
- typecheck、lint、git diff --checkを実施。全Plannerテストとbuildはdev向けPRのGitHub Actionsが実行するため、無条件のローカル重複実行はしない。

実行結果（2026-10-24）: typecheck PASS、lint PASS、Chromium **4 PASS / 0 FAIL / 0 SKIP**、git diff --check PASS。
PC/390pxの代表スクリーンショットを目視確認した。通常時の画像には登場アニメーション途中のものも含む。
初回はsandboxのlocalhost起動制限で実行不可のため、許可された環境で再実行した。
製品検証の途中ではテスト側のHome対象要素（section→header）と、メンバー退出中の古いDOMを待つ処理を修正した。
メンバー切り替え後の新DOMを待つようにして再実行し、全4条件が成功。製品コードの追加変更、期待値の緩和、skipは行っていない。

## 未確認事項とユーザーの確認項目

- Vercel Previewで通常/「動きを減らす」を切り替え、各設定でページを再読み込みして登場・退出・スクロール・hover/tapを確認。
- Framer Motion 12.38.0のuseReducedMotionはマウント時の値を保持する実装。表示中にOS設定を変える場合は再読み込みして確認する。CSSとページ端スクロールの判定は設定変更を直接反映する。
- iPhone Safari実機で文字・タッチ・スクロール・メンバー切り替え・Q&A開閉・Plannerタブ/検索への移動を確認。
- 外部X埋め込み内部の動き、実問い合わせ配送、LINE認証完走、画像生成・データ保存復元の全経路は局所テスト対象外。
- CIの最終結果と別セッションの独立監査を確認した上で、ユーザーがマージ判断する。
