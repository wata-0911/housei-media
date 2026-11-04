# A2: 初回captureの限定性能改善

2026-10-26 JST。base P3 `6361857465d4e4004711f0d6d785368c253a716d`、remote比較 `e18b576a5e3e5a00c874c7c84445ccd3bf0e8e05`、dev `1cec2cb661de00bc47eb550ba6509a7788da228d`。

A2のみを実装した。外部AttemptGraphの初回captureの残存P2は維持する。旧試作B・A3・Worker・JSON専用入口は含まない。

## 変更と安全性

- ArrayはMap/Set内部slotを持てないため、配列だけreceiver probeを省く。Array Proxyも認証せず、既存の子→親native guardで拒否する。通常objectの両probeは維持し、prototypeを偽装したMap/Setも拒否する。
- private `sameGuardCopies`はdescriptor captureで内部生成したJSON copyとnative serialization結果のguard比較だけに使用する。capture側のkey/descriptor/JSON値/密配列/循環/深さ確認、native側の独立したdata propertyが前提。配列長、own key集合、値、native結果のprototypeを比較する。
- 汎用`sameAttemptData`はbyte不変。retainedやCommand等の外部入力のdescriptor走査を置換しない。
- 元入力のdescriptor走査、子→親guard順、問題発見後のnative clone停止、拒否診断、公開前の全体clone、deep freeze、内部生成nodeのみのWeakSet登録、全node参照分離、contextごとのschema/意味検証を維持する。
- P3深さ64制限、既知入力診断と予期しないError/cause identityの区別を維持。schema23/24、backup v1/v2/v3、source/IndexedDB authority、full replay、永久ID予約、owner/Undo、公式数量優先、両安全フラグfalseを変更しない。
- 既存の重複Command再送はcontext再検証前にreturnする。dev由来の既存挙動であり、A2で全呼出しの再検証を保証したとは説明しない。

## 検証

| 検証 | 結果 |
| --- | --- |
| 追加2テスト、修正前P3 | 2 FAIL。配列probe 14回、native-owned cloneのdescriptor再走査229回 |
| 最終snapshot suite | 209 PASS、FAIL/CANCEL/SKIP 0。配列probe 0・通常record probe維持・再descriptor 0・全fresh nodeのguard＋最終clone回数を確認 |
| remote/P3/A2の全戻り値比較 | 31ケース一致。正常・不正値・診断・adapter出力・owner/deletion。深い入力のP3修正は別検証 |
| clone全境界/追加安全性 | 48チェック成功。Error/cause identity、late trap、外部freeze、認証node再利用、context変更 |
| 保存・復旧の追加比較 | 26シナリオ成功。schema23/24 full replay、v1/v2/v3、予約・receipt・owner・TODO・厳格Undo、再hash改変拒否、source切替、CAS/Lock/失敗保全 |
| Chromium境界 | 24チェック成功。N2元6件/getter 0、後続trap、偽装Map/Set、混在node全参照分離、5,000/10,000階層の深さ64拒否、Error/cause |
| Chromium storage | 13チェック成功。実IndexedDBの初期化/置換失敗、Web Lock/CAS、元raw/checkpoint/ID保全 |
| 限定E2E | 320px/390pxの2シナリオ成功。検索→登録→保存→再読込、取消、二重submit、source切替、旧localStorage非接触。実IME/実端末試験ではない |
| 局所型/ESLint/diff | 型検査362依存ファイル、変更TSのESLint、diff check成功 |

広い既存ローカルsuiteは途中で打ち切り、完走PASSと数えない。前回全保存suiteは約27分で、焦点を絞った比較を完了後、全Planner/typecheck/lint/buildは最終HEADのGitHub CIで確認する。期待値・skip・timeoutの変更なし。最終CI結果・対象SHAはPR本文/checksを参照。

## 性能条件

Node v24.13.0 / Darwin 24.6.0 / Intel Core i3-1000NG4 / 4 logical CPU / 8GiB。Chromium 156.0.8078.4、同hostの1x/4x CPU制限。固定依存。Node/Chromium/他の作業テストを重ねず、3独立process/browserセッション×10試行、各条件各版30試行。版順を回転・反転し、同一process内でdev/remote/A2を交互測定。中央値 / nearest-rank p95（30件の29番目）をmsで示す。外れ値を除外していない。

coldはfresh未認証graphの初回createWorkspace。module/AJVコンパイル、fixture生成、入力transport/parse、DOM、DBを除く。GCは計測前。全Workspace一致・入力不変を確認し、browserは全node参照分離/freezeも確認。remote→A2には別commitのP3深さ制限も含む。当日のhost負荷によるばらつきがあり、過去の設計評価runとの引き算はしない。session別・CPU時間・全sampleも保全する。

realは実カタログの異なるOfferingをv22移行したschema23 fixture（500件: 9,634 node、約1.66MB、max depth 6）。new24はsafe制度検索結果由来の別ID Attempt（同一科目の反復）。合成は異なるIDの独立Attempt。10/30/100件は通常〜中間の仮定、500件はbulk、1,000件はstress。実利用統計や最大owner/progress量を代表しない。

### Node cold: 中央値 / p95

| fixture | dev | remote | a2 |
| --- | --- | --- | --- |
| real-10 | 67.2 / 223.0 | 79.6 / 662.6 | 86.1 / 206.8 |
| real-30 | 79.0 / 246.6 | 135.7 / 399.5 | 117.2 / 446.9 |
| real-100 | 77.1 / 147.0 | 223.2 / 493.4 | 181.6 / 532.9 |
| real-500 | 232.1 / 499.3 | 1094.5 / 2245.9 | 775.7 / 1468.3 |
| synthetic-100 | 19.3 / 36.7 | 203.1 / 378.1 | 129.0 / 190.8 |
| synthetic-500 | 75.7 / 432.0 | 921.1 / 2245.9 | 695.4 / 2265.8 |
| synthetic-1000 | 106.4 / 218.8 | 1857.3 / 3882.7 | 1255.7 / 2318.2 |
| new24-10 | 10.4 / 18.8 | 27.4 / 80.2 | 22.4 / 83.7 |
| new24-30 | 17.2 / 35.7 | 63.1 / 203.6 | 49.5 / 100.0 |
| new24-100 | 33.0 / 75.9 | 168.5 / 398.9 | 119.8 / 320.5 |
| new24-500 | 117.6 / 182.6 | 703.4 / 1083.2 | 495.5 / 789.9 |
| new24-1000 | 216.7 / 1021.0 | 1341.2 / 5871.6 | 987.8 / 3001.1 |

### Chromium cold: 中央値 / p95

| fixture | CPU | dev | remote | a2 |
| --- | --- | --- | --- | --- |
| real-10 | 1x | 29.5 / 76.6 | 50.0 / 123.5 | 40.9 / 83.1 |
| real-30 | 1x | 24.6 / 35.9 | 69.5 / 105.6 | 64.3 / 135.5 |
| real-100 | 1x | 39.2 / 91.3 | 179.4 / 574.7 | 153.8 / 572.5 |
| real-500 | 1x | 111.7 / 249.2 | 842.7 / 1967.1 | 687.2 / 1308.2 |
| synthetic-1000 | 1x | 89.5 / 144.1 | 1372.9 / 2960.8 | 1044.1 / 1697.2 |
| new24-10 | 1x | 5.1 / 11.2 | 21.5 / 34.9 | 16.3 / 24.7 |
| new24-30 | 1x | 8.0 / 17.5 | 50.4 / 80.2 | 34.5 / 47.2 |
| new24-100 | 1x | 18.6 / 36.6 | 155.2 / 314.7 | 111.3 / 163.0 |
| new24-500 | 1x | 91.0 / 310.4 | 674.5 / 1299.3 | 482.1 / 1064.8 |
| new24-1000 | 1x | 125.6 / 187.1 | 1269.4 / 2507.0 | 925.8 / 1417.9 |
| real-10 | 4x | 74.6 / 170.2 | 138.1 / 398.2 | 123.0 / 296.0 |
| real-30 | 4x | 89.2 / 142.5 | 235.4 / 448.7 | 183.5 / 663.0 |
| real-100 | 4x | 101.5 / 220.0 | 513.0 / 823.8 | 387.6 / 778.3 |
| real-500 | 4x | 253.7 / 435.1 | 2221.3 / 3394.9 | 1671.2 / 2253.6 |
| synthetic-1000 | 4x | 244.5 / 417.3 | 4085.9 / 7184.0 | 3087.4 / 4502.9 |
| new24-10 | 4x | 14.2 / 38.5 | 57.0 / 130.6 | 48.7 / 162.7 |
| new24-30 | 4x | 33.2 / 158.2 | 187.0 / 678.4 | 112.9 / 495.4 |
| new24-100 | 4x | 62.2 / 177.0 | 543.7 / 1206.2 | 377.2 / 855.2 |
| new24-500 | 4x | 220.6 / 454.7 | 1932.6 / 4364.2 | 1477.1 / 4173.5 |
| new24-1000 | 4x | 363.8 / 1320.5 | 3998.3 / 8099.1 | 2973.7 / 4970.9 |

### メインスレッド停止

setTimeout待ち時間とPerformanceObserver Long Taskを別観測。Long Task欄は30試行中の最大値で、core p95や全アプリのINPとは異なる。4xはdesktop emulationで、実iPhone/Android/Safariの代用ではない。

| fixture | CPU | remote timer p95 / Long Task max | A2 timer p95 / Long Task max |
| --- | --- | --- | --- |
| real-30 | 1x | 105.8 / 258.0 | 135.7 / 176.0 |
| real-500 | 1x | 1967.4 / 2514.0 | 1308.3 / 1390.0 |
| synthetic-1000 | 1x | 2961.0 / 3527.0 | 1697.5 / 2371.0 |
| new24-30 | 1x | 80.3 / 83.0 | 47.3 / 0.0 |
| new24-500 | 1x | 1299.6 / 1640.0 | 1065.2 / 1453.0 |
| real-30 | 4x | 448.8 / 976.0 | 663.0 / 784.0 |
| real-500 | 4x | 3395.4 / 4593.0 | 2253.8 / 2385.0 |
| synthetic-1000 | 4x | 7187.1 / 8160.0 | 4508.0 / 4930.0 |
| new24-30 | 4x | 681.7 / 984.0 | 499.2 / 1057.0 |
| new24-500 | 4x | 4366.0 / 8454.0 | 4177.3 / 9204.0 |

50ms以下の連続main taskを目標として維持する。A2でもbulk/stressの長い同期停止は残り、小規模を含めp95の一律改善は主張しない。dev比2倍だけで合否を決めず、安全性・絶対時間・応答性を分ける。30試行のp95は同ホストの推定であり、実端末SLA・独立監査・P2解消・マージ承認ではない。

### 移行30件のtail追加調査

主測定30試行では、移行30件のp95が1xで105.6→135.5ms、4xで448.7→663.0msと悪化した。push前の懸念として当該fixtureを別の1 browser sessionで各100回交互測定し、1xは中央値75.5→62.5ms / p95 288.8→225.0ms、4xは337.8→265.7ms / p95 986.2→708.5msとなった。持続的な悪化は再現しなかったが、host負荷/GC等の影響を厳密に分離できてはいない。主30試行を削除・置換・混合せず、`focused-summary.json`とraw 400 sampleも保存する。実端末のtail性能は独立監査の重点事項とする。

### 100 Command full replay

設計評価と同じ27,668 bytesのschema24 state。各版30試行、全state/Workspace一致と入力不変。全Command replay・参照整合性・ID予約・snapshotを省略しない。

| dev | remote | a2 |
| --- | --- | --- |
| 5924.8 / 9639.8 | 5818.3 / 9153.0 | 5187.9 / 9688.9 |

中央値は約10.8%短縮、p95は約5.9%増。第1/第2セッションでは増減の向きも異なったため、一律の高速化や全端末の非退行保証とは扱わない。

## 残件と独立監査

通常recordのreceiver例外、重複subtree native cloneは残る。残存P2（外部Graph初回capture/bulk同期停止）を維持する。大履歴full replay負荷と既知通常Planner restoreのfile input timeoutも既存残件。限定E2E成功で既知timeoutの解消は主張しない。

再監査: helperの入力生成元、Array/Array Proxy/偽装Map/Set、guard停止順とN2、全参照分離、WeakSet/context、Error/cause、深さ64、schema23/24・backup・CAS/Lock/Undo/予約の組合せ。実低性能端末/Safari、重いowner/progress/履歴、複数capture/replayを含む保存全フローのp95・応答性・メモリは追加確認が必要。

raw証拠・再現scriptはプロジェクト直下のリポジトリ外 `pr183-a2-implementation-20261026/` に保全。`node-session-*.json` / `browser-session-*.json` / `replay-session-*.json`、`bench-*.mjs`、`run-sessions.mjs`、`performance-summary.json`、各logを参照。集計は同梱`measurements.json`。対象validationのSHA-256も記録。既存未追跡46件、旧P2 patchと以前の証拠には書き込まない。

再現時は新しい検証フォルダと出力先を使い、保存済みJSON/logを上書きしない。
