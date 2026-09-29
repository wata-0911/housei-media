# 法政 履修データ取り込み

Chrome の「パッケージ化されていない拡張機能を読み込む」から、この `hosei-planner-import` ディレクトリを選択します。成績表ページを開き、拡張の **現在の成績表を読み取る** を押すと、JSON をコピーまたは保存できます。

## 権限と安全性

- `activeTab`: ユーザーが popup のボタンを押した現在の tab だけを、一時的に読めるようにします。
- `scripting`: その tab 内で read-only parser を実行するために使います。

`host_permissions` は指定しません。`<all_urls>`、cookies、history、webRequest、外部送信、telemetry、remote code、eval は使いません。法政 ID・パスワード、Cookie、セッショントークンは読み取りません。ページを書き換えず、JSON は端末内で生成します。

Super Tables により同じ `id="seisekiTabele110"` の table が複数生成されることがあります。拡張は全候補の `tr.column_even` / `tr.column_odd` を確認し、24 logical cell の科目行が最も多い実データ table を自動選択します。`td.line_y_label` を除いた logical cell が 24 個の row だけを処理し、category row は科目として出力しません。
