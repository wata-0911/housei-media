# Issue #193 局所検証記録

2026-10-25 / macOS / Node v24.13.0。開始時dev `ae87f2cd33d82dfda025c913c21b857c3f326f69`。

| 検証 | 結果 |
| --- | --- |
| `npm run test:institutional` | 62 PASS / 0 FAIL / 0 SKIP。本科/教職コードのscope・用途と本番推移的import非依存の既存検査を含む |
| `npm run test:attempt-ui` | 95 PASS / 0 FAIL / 0 SKIP（既存84 + 新規11） |
| `npm run test:attempt-ui-browser` | Chromium 11 PASS / 0 FAIL / 0 SKIP（既存9を維持・検索2幅追加） |
| 検索Enter抑止後の限定ブラウザ再確認 | `--test-name-pattern='scope/code'` 2 PASS / 0 FAIL / 0 SKIP。1280px / 390px |
| 全502配置のbridge変換smoke | safe 273 / ambiguous 214 / conflict 6 を変換・既存validatorで検証。非科目枠9件を全拒否 |
| 変更4 TS/TSXのstrict型検証（推移的依存を含む） | PASS |
| 同4ファイルのESLint | PASS |
| `git diff --check` | PASS |
| 保護対象のdevとの差分 | なし（下記） |
| 元Issue #190 checkout | cleanを維持 |

## 検証した境界

- 全502件は既存`loadCurrentCurriculumSearchAdapter().search({scope:{kind:'all'}})`で列挙。各行を`makeSearchAttempt()`へ渡し、safeのconfirmed／ambiguous・conflict保持、candidateAuditIds一致、本人適用unknown、予定年度null、方式unknownをassertした。bucketは例外をassert。出力は `{"safe":273,"ambiguous":214,"conflict":6,"bucketRejected":9}`。
- 新規局所suiteは参照・revision・CV・scope・IC・role・候補・脚注・構成単位・方式制約・コード証拠の改変拒否、非科目枠kind書換え拒否、複数候補の全保持、入力エラー拒否を確認。失敗時は元Workspaceの完全一致を検査。
- 検索由来Attemptを既存`applyCommand()`へ登録し、独立UUIDv4・同一科目の複数追加・固定再送の冪等性・異なる再送の拒否、編集/削除/Undoでの参照保持を確認。元Workspaceの進捗・評価・TODOのownerとpayloadをdeep比較して非変更を確認。
- 構成単位null/0と本人寄与単位の省略/null/0を個別に確認。合成read-modelケースのみで、公式registryは変更しない。
- ブラウザはsafe/ambiguous/conflict追加、予定年度空欄・方式unknown、本人適用unknown、候補/roleの表示、エラー時の件数不変、選択後の検索変更・通常Enter・IME Enterで誤登録しないことを確認。
- コード検索（実在コード・不一致）、scope・共通科目、502件の総件数/追加表示、非科目枠のdisabled、キーボードでの明示選択、狭幅で水平overflowなしを確認。全行へのアクセスは30件単位の累積表示（slice上限を増やす）で確保する。
- ブラウザsuiteはlocalStorageのread/write/remove/clearを例外化し、既存primary/recoveryの原文bytesとstorage呼出0を検査する。新Attemptへの旧進捗コピーや保存は行わない。
- gate無効/production serve（flag=1含む）で `/__dev/attempts`、queryによる有効化、`main.tsx`、新`PlacementSearch.tsx`、新`searchBridge.ts`、既存operationsへの直接アクセスが404。
- `searchEnabled`既定falseで共有Formの従来経路を維持し、YI-05 Workbenchだけ明示true。SSRによる両経路の検査を含む。

## 実行条件

```sh
npm run test:institutional
npm run test:attempt-ui

PLANNER_PLAYWRIGHT_MODULE=/Users/wata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
PLANNER_BROWSER_EXECUTABLE=/Users/wata/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-x64/chrome-headless-shell \
npm run test:attempt-ui-browser
```

最後のEnter抑止追加後は同じ環境で以下2件だけを再確認した。全11件の重複再実行は行っていない。

```sh
node --import tsx --test --test-name-pattern='scope/code' tests/attempt-workbench.browser.mjs
```

型・Lintは全体ではなく以下4ファイルを指定。

```sh
./node_modules/.bin/eslint src/planner/attempts/workbench/searchBridge.ts dev/attempts/AttemptForm.tsx dev/attempts/PlacementSearch.tsx dev/attempts/Workbench.tsx
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --esModuleInterop --resolveJsonModule --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --types vite/client --lib ES2022,DOM,DOM.Iterable src/planner/attempts/workbench/searchBridge.ts dev/attempts/AttemptForm.tsx dev/attempts/PlacementSearch.tsx dev/attempts/Workbench.tsx
```

## 非変更・限界

本番components/pages、公式src/data、Attempt types/schema/validation、既存catalogView/operations、migration、persistence、docs/planner-yi-01、Vite gate設定、package.json/lockfileにorigin/devとの差分なし。新しい本番importはなく、既存institutional suiteが本番entryの推移的import graphも検査する。

全体typecheck/lint/test:planner/buildは未実施。本番buildのbyte比較や実際のproduction bundle作成は行っておらず、本番非混入についての局所証拠は上記import graph・gate・変更パスの確認。Safari/iPhone実機、公式リンク再監査、独立監査は未実施。

#181/#183に依存せず、未マージの安全性修正を取り込んだとは扱わない。一般公開は禁止のまま。最終HEADの全体CIが成功していれば同じ全体検証の再実行は不要。未実行/失敗の項目だけユーザー側で追加確認する。
