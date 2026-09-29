# 法政 履修データ取り込み

Chrome の「パッケージ化されていない拡張機能を読み込む」から、この `hosei-planner-import` ディレクトリを選択します。成績表ページを開き、拡張の **現在の成績表を読み取る** を押すと、JSON をコピーまたは保存できます。**Plannerで確認** は、JSONをURLやサーバーへ送らずに、Plannerの取り込みプレビューを開きます。反映はPlanner上の **確認した変更を反映** を押すまで行われません。

## 権限と安全性

- `activeTab`: ユーザーが popup のボタンを押した現在の tab だけを、一時的に読めるようにします。
- `scripting`: その tab 内で read-only parser を実行するために使います。
- `storage`: `chrome.storage.session` に、Plannerへ一度だけ渡す成績JSONを最大5分だけ保持します。受領成功時・期限切れ時に削除します。
- `https://hosei-tsukyo-media.com/*`: 本番Plannerだけに、受け渡し用content scriptを実行します。`/planner` 以外のrouteへデータを渡すことはありません。

`<all_urls>`、cookies、history、webRequest、tabs、外部送信、telemetry、remote code、eval は使いません。法政 ID・パスワード、Cookie、セッショントークンは読み取りません。成績JSONはURL query/fragmentに含めず、ページを書き換えません。

## 本番版と開発版

- `manifest.json` は本番Web Store向けです。許可するPlanner originは `https://hosei-tsukyo-media.com/*` だけで、popupには **Plannerで確認** だけを表示します。
- `npm run build:extension-dev` は `planner-targets.config.json` を読み、実機テスト用の `extension/hosei-planner-import-dev` を生成します。この版だけが本番originとdev originの両方を許可し、**Planner(dev)で確認** を表示します。
- dev handoff先は `https://dev.hosei-tsukyo-media.com` です。Vercelでこのdev branch domainが `dev` branch に紐づいていることを前提とし、一時Preview URLをデプロイごとに書き換える必要はありません。本番manifestへdev originを追加しないでください。

## 本番の実機確認

1. Chromeの拡張機能管理画面でこの拡張を再読み込みする。
2. 法政の成績確認ページを再読み込みする。
3. **現在の成績表を読み取る**、続けて **Plannerで確認** を押す。
4. `https://hosei-tsukyo-media.com/planner` が開き、「拡張機能から○科目を受信しました」と取り込みプレビューが表示されることを確認する。
5. この時点では計画に反映されていないことを確認し、照合先・年度・期・選択状態を見直す。
6. 必要な行だけ選び、Plannerで **確認した変更を反映** を押す。
7. 最初に開いたURLを再度開いても、同じtokenでは受信できないことを確認する。

ローカル開発時は本番manifestへlocalhost権限を追加しません。

## dev Plannerへの実機確認

1. このリポジトリのrootで `npm run build:extension-dev` を実行する。
2. Chromeの拡張機能管理画面でデベロッパーモードを有効にし、**パッケージ化されていない拡張機能を読み込む** から生成された `extension/hosei-planner-import-dev` ディレクトリを選ぶ。すでに読み込んでいる場合は、生成後にこのdev拡張の **再読み込み** を押す。ファイルが更新されてもChrome側は自動では再読み込みしません。
3. 法政の成績確認ページを再読み込みする。
4. 拡張で **現在の成績表を読み取る** を押し、続けて **Planner(dev)で確認** を押す。
5. `https://dev.hosei-tsukyo-media.com/planner` が開くことを確認する。
6. 「拡張機能から○科目を受信しました」と取り込みプレビューが表示されることを確認する。
7. この時点では計画にまだ反映されていないことを確認する。
8. 照合先、年度、期、選択状態を確認し、必要な行だけを手動で反映する。
9. 最初に開いたURLをもう一度開き、同じtokenでは受信できないことを確認する。
10. dev branch domainがVercelで `dev` branchへ紐づいたままであることを確認する。通常はPreview URLを更新する作業は不要である。

Super Tables により同じ `id="seisekiTabele110"` の table が複数生成されることがあります。拡張は全候補の `tr.column_even` / `tr.column_odd` を確認し、24 logical cell の科目行が最も多い実データ table を自動選択します。`td.line_y_label` を除いた logical cell が 24 個の row だけを処理し、category row は科目として出力しません。
