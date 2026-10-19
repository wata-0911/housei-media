# YI-07 第1段階：卒業adapterと安全境界

Issue [#177](https://github.com/wata-0911/housei-media/issues/177)、dev向けDraft [PR #179](https://github.com/wata-0911/housei-media/pull/179)。開始時のdev: `a4c9a088680b376daf7a66a22b62d755036a2107`。最終再開時dev: `1866c6b7668458a6c664d3b2461b4f78c6cc9697`（差分はroot READMEのみ、fast-forward済み）。ブランチ: `feat/yi-07-graduation-adapter`。第1段階の実装・自己検証であり、独立監査は未実施。

独立Attemptを記録できることと、その量を卒業要件に算入できることを分離する。**正の新Attempt算入は本PRの対象外**。YI-02の全CurriculumVersionは本人適用未確認で、方式/完成/反復/公式内訳との排他的associationも新Attemptの算入根拠として未実装である。省略/nullを0にせず、理由・候補・影響範囲を返す。

一方、既存v22規則で評価できる公式原行・認定・公開科目・卒論は、元sourceに束縛したretained-onlyの経路を維持する。未知Attemptを足してもその既知数量を消さない。これは新旧の合算結果ではなく、既存結果とAttempt側の保留を別々に返すAPIである。

| 成果物 | 内容 |
| --- | --- |
| [adapter-contract.md](adapter-contract.md) | API、数量authority、保留/未対応/除外、consumerの利用条件 |
| [consumer-audit.md](consumer-audit.md) | 既存engineの入力・処理順・Offering依存・危険な変換 |
| [acceptance.md](acceptance.md) | 固定baseline、16必須回帰、実行結果、CI・既知失敗 |
| [handoff.md](handoff.md) | 学科・規則matrix、後続小PRの依存/受け入れ、YI-08と独立監査 |
| `src/planner/attempts/graduation/` | 独立pure adapter、型、潜在影響の計算 |
| `tests/attempt-graduation.test.mjs` | 192固定旧出力＋新Attempt安全境界・YI-06再読込 |

`npm run test:attempt-graduation` を追加し、既存CIの `test:planner` に組み込む。production entry、PlannerPage、schema22/23、backup、IndexedDB authority、YI-04 projection、YI-05/06操作、既存engine、公式catalogには変更を加えない。一般公開・Ready化・merge・Issue closeは行わない。

既存engine側の監査根拠を新Attempt側の監査済み実装とみなさない。未実装の量に0を返さず、`Decision.value=null` とreasonで示す。公式aggregate・内訳・手動値を直接足すAPI、架空Offeringを発行するAPIはない。
