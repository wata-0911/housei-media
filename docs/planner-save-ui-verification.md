# Issue #95 保存待ちUIのブラウザ回帰

`npm run test:planner-browser` は実Chromiumと別タブのWeb Lockを使用する。通常のplannerテストとは別に実行し、ブラウザが利用できない場合は成功扱いにしない。

PlaywrightとChromiumをテスト環境で用意する。Playwrightが本リポジトリからimportできる場合はそのまま実行できる。外部ランタイムを使う環境では `PLANNER_PLAYWRIGHT_MODULE` にそのモジュールの絶対パス（例: `/runtime/node_modules/playwright/index.mjs`）を渡す。必要なら `PLANNER_BROWSER_EXECUTABLE` にChromiumの実行ファイルを渡す。`PLANNER_BROWSER_PORT` の初期値は4180。

テストは独立ブラウザcontextへ合成データを入れ、127.0.0.1でViteを起動する。既存ブラウザプロフィールや本番データを使用しない。

検証対象:

- Web Lock待機中の卒論状態・日付・地理リポート編集の無効化。
- ロック解放後の編集再開と再読み込み後の保存値一致。
- 保存例外時の原文不変・利用者へのエラー表示・正常な再試行。
- 他タブ更新エラー時の卒論編集停止。
- 保存中の成績取込プレビュー編集停止。
- 復元のロック待ち中も卒論編集停止、成功後の再開。
- 主キーnull・recoveryのみの保護ファイル実ダウンロード、原文一致、通常復元拒否。

iPhone Safari実機・Filesへのネイティブ共有保存はこのテストの対象ではなく、未完了のAcceptance Criterionとして残す。
