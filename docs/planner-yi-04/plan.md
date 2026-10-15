# YI-04 実装前の責務・検証計画

基準dev: aa74fef364ce1ac583c2599eb2e92f2404e73a42。専用clone / feat/yi-04-pure-migration。

1. Source: local raw22 / backup v1 / backup v2を区別。raw6実測digestと固定原版、v1 registry、v2 snapshot/semantic規則を確認。通常loadの結果を正本にせず、検証済み原文とparse直後のstateを保管。再読込で変化するsourceは保留。全未知fieldをfail closed。
2. Target: 旧itemsは独立Attempt、孤立旧Offeringはdetached owner。同ownerの記録は共有ownerを保持。公式原行・内訳・meta・認定・卒論・公開科目は別領域に完全コピー。制度identityは監査safeのみ、本人適用/実績年度は推測しない。
3. ID: 準備段階でUUIDv4を発行。原文SHA/state SHA/原版SHA/rule/version/旧キーに固定した割当表を入力し、変換内では乱数を呼ばない。既存namespaceとの衝突も拒否。再previewは同表を再利用する。
4. 成功条件: source検証、target graph検証、対応台帳・件数・全field/省略/配列順・owner・数量の往復比較をすべて通る。target日付エラーは原値/assessment/ownerを含め全体保留。不明identityは候補・理由付きで保存可能なら成功（本人適用や卒業算入の承認ではない）。未知版/原版/field、衝突、不正参照は拒否。
5. Tests: 合成学習者fixtureで全status/方式/省略0正値（v22 nullは拒否）、公式only/mixed、同制度別Offering、detached/TODO、全8scope、既存168 baseline、原文・入力不変、ID再利用、target改ざん、日付差分、原版互換性、正規化/認定shadow、storage trapを検証。既存attempt/institutional/planner/extension/bookmarklet/typecheck/lint/build/diff-checkを実行。

現行schema22、保存・UI・卒業engine・カタログは編集しない。新保存schema/CRUD/修正UI/永続化はYI-05/06以降。過去PASSは今回の検証に数えない。
