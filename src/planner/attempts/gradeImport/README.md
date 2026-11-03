# 年度横断成績取込のpure contract

公開APIは `sourceArchive.ts` → `ledger.ts` → `preview.ts` → `adoption.ts`。
原文/正規DTO、順序付き不変journal、読取preview、明示判断からのメモリ内操作計画を扱う。
I/O、保存、正規ID発行、burn、catalog照合、卒業算入は行わない。
通常PlannerPage・production entry・既存保存hostには接続していない。

G01a/G01b/G02a(R-01修正)/G02bで検証したwire契約を維持するため、
`0.1.0-prototype`とformat/policy名・容量上限を保持する。正式N/B/A/U採番ではない。
`npm run test:grade-import-pure` と `npm run typecheck:grade-import-pure` で局所検証する。

strict parserは `../jsonInput.ts`、DTO decoderは `../../gradeImport/gradeImportContract.ts`、
digestは依存のない正規leaf `../../digest.ts` を直接参照する。
旧backup公開APIも同じleafを互換re-exportする。pure/leafからbackup・validation・AJV・catalog・保存hostへのruntime依存はない。
文字列からの動的コード生成を禁止したcold importも試験する。

## 保存hostへ接続する前の必須条件

- `canCommit=false`。preview JSON、選択値、digest、bare G01b operation、
  `explicit-test-only-untrusted`割当は保存資格/発行証明にならない。
- hostの生きたproposalを現在のsource/ledger/floor/authority/environment、
  preview/selection/行target/理由、全ID割当、順序付きoperation/resultへ束縛する。
- **判断receiptをoperationに対応付け、state・予約・authority/outcomeと原子的に保存する。**
  同operationId再送時にも判断receiptを照合する。裸のoperationだけを保存入口へ通さない。
- 正本floor、session allocator、正規発行と不可逆burn、失効・取消、exclusive Lock、
  元record検査、全field CAS、IDB原子transaction、strict再読込、結果不明時の処理が必要。
- pureな失敗で中間結果を返さないことは、hostが発行済みIDを再利用できる意味ではない。
- UI確認は大学identity/原成績の真正性を証明しない。manual associationは未確認のまま。
