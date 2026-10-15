# YI-04 受け入れ・検証記録

2026-10-15（Asia/Tokyo）。基準dev `aa74fef364ce1ac583c2599eb2e92f2404e73a42`。独立cloneで既存lockfileから `npm ci --ignore-scripts --no-audit --no-fund` を実行。package-lock・依存指定は変更していない。実利用者データは使用せず、学習者stateは全て合成fixture。

## 今回実行した結果

| コマンド/比較 | 結果 |
| --- | --- |
| `npm run test:migration` | PASS 133 / fail0 / skip0 |
| `npm run test:attempts` | PASS 132 / fail0 / skip0 |
| `npm run test:institutional` | PASS 36 / fail0 / skip0 |
| `npm run test:planner` | PASS 3,305 = 既存3,172＋新133 / fail0 / skip0 |
| `npm run test:extension` | PASS 54 / fail0 / skip0 |
| `npm run test:bookmarklet` | PASS 168 / fail0 / skip0、生成物checkを含む |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS、既存500kB chunk警告あり。grade-import/curriculum catalog checkを含む |
| `python3 docs/planner-yi-01/verify.py` | PASS、321/502/686/209、公式502行、578コード行、84脚注、原版digest・分類一致 |
| dev原版とのproduction build比較 | 全12ファイルの相対pathとSHA-256が完全一致 |
| `git diff --check` / staged diff check | PASS |

新規133件は単体のtest数。中の168シナリオ反復や複数field比較を別テスト件数として加算していない。Planner全体の件数は新133を内包するため、別suiteとの合算総件数は示さない。

## 新規テストの条件

- local/v1/v2 × empty/items/official/mixedの原文・全state往復。公式onlyではAttemptを作らない。
- 全6status、通信/メディア/スクーリング、寄与省略/0/2・旧登録4の分離。旧v22の寄与nullは拒否。targetのnull許容を旧契約へ逆適用しない。
- active/detached、共有旧owner、TODO-only、unowned TODO、assessment/report順とID、optional calligraphyBatchStatus。
- 公式aggregate null/0/2と内訳17を独立保持。公式ID/fingerprint/source/候補・手動年度・rawYear/Term・capture・meta・認定・公開科目・全scope卒論指導を保存。
- 同制度の異なる旧Offeringを独立Attemptにし、順序を維持。safe/ambiguous/conflict/unmatchedで候補・理由を保持。候補先頭を選ばない。
- 再preview中のrandomUUID呼出禁止、existing表の再利用、別割当要求の区別、UUID重複・namespace/legacy/master/予約衝突・不正binding/coverage・有効UUID交換・未検証JSON表の拒否。
- 原文不変、deep freeze、偽source handle拒否、明示的に修正した新rawに旧bindingを使うことの拒否。
- local/v1/v2それぞれで不実在日2027-02-30・不正月2027-99-99を全体held。通常日・閏日・nullをready。原assessment/owner/payload診断、heldの旧計算projection拒否。
- unknown Offering、owner key不一致、重複ID/公式親欠損/候補参照欠損、unknown/余剰/必須欠損field、認定shadow、再読込正規化が必要なstateの拒否/保留。
- schema1/7/21/23/999、未知backup版、protection、破損JSON、重複key、unsafe integer/非有限数/negative zeroを拒否。
- raw6の欠損/追加/digest差、v1/v2原版SHA破損、semantic単位/順序/未知field/rule差を拒否。v2の許可済みcitation/表示変更はsource版を保持。
- target数量・source fingerprint・省略/null・meta・認定・卒論・公開科目・field台帳・配列順・owner再割当・元map key・assessment ID・report番号・Placement改変を独立比較で拒否。target graphのPASSだけでは保存証明にならないことを再現。
- browser localStorage getterをtrapして全pipelineのアクセス0。実装にstorage書込み/Lock/clock APIがないことも検査。sourceの旧load比較用storeはメモリの読み取りだけで、setItemは必ずthrowする。

## 旧計算との比較

新suiteでは既存168シナリオのうち正規原版の160ケースをsource→target→legacy projectionへ通し、旧engineの完全出力と比較して一致。意図的にOffering creditsをnullへ変えた8ケースは、未承認catalogなのでdecoderが拒否することを確認。基準を通すためそのcatalogを正規原版として登録していない。

既存suiteの `168 complete outputs preserve baseline except six reviewed P2 completion quantities` は無変更でPASS。過去baselineファイルも、six reviewed P2の期待値処理も変更していない。全8非共通scopeでは混在fixtureでも完全出力を比較。ordinary/S/completion、区分進捗・上限・超過・排他配分、公式優先による重複防止、unknown・診断を個別に捨てたsubset比較ではなく、出力全体を比較している。

## 変更範囲・production隔離

既存trackedファイルの変更はpackage.jsonのtest:migration追加とtest:plannerへの組込みのみ。追加ファイル:

- `src/planner/attempts/migration/contracts.ts`
- `src/planner/attempts/migration/source.ts`
- `src/planner/attempts/migration/assignments.ts`
- `src/planner/attempts/migration/transform.ts`
- `src/planner/attempts/migration/preview.ts`
- `tests/fixtures/migration-fixture.mjs`
- `tests/migration.test.mjs`
- `docs/planner-yi-04/plan.md`
- `docs/planner-yi-04/README.md`
- `docs/planner-yi-04/acceptance.md`
- `docs/planner-yi-04/handoff.md`

全12ファイル。既存PlannerState/schema・attempt validator・保存/backup・卒業engine・gradeImport・catalog/原版・UI・拡張/bookmarklet・既存テスト・過去監査文書はbyte不変。既存「production runtimeはAttemptへimportしない」テストを弱めず、新モジュールを独立Attempt配下に配置した。基準devを別の一時ディレクトリへgit archiveして同じ固定依存でbuildし、dist全12ファイルのpath/SHA一致も確認した。他worktree・#145のブランチには変更していない。

## 未実施・未保証

実データの移行・保存・復元のブラウザテスト、primary/recovery書込み、新backup往復、Web Lock競合・quota試験、PC/iPhone Safari実機は未実施。今回read-onlyであり保存UI/保存APIを作っていない。新規保存schemaの安全性、発行表の再起動後復元、大学の未確認identity/適用条件、全卒業算入完成をPASSとしない。独立監査は未実施で、Draft維持・merge/Issue closeを行わない。
