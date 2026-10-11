# メディアスクーリング進捗

> **2026-10-11 現行仕様:** state22、Offering ownerを継続。動画/テストに加えassessment ID・名称・予定日・完了も保存し、全回数nullを許容する。入力確定保存と全state backupは#95/PR #138で実装済み。以下のschema5と当時の将来機能は履歴。[年度非依存のAttempt owner](planner-year-independent-design.md)は未実装、具体移行schemaは未確定。同Openingに別年度の進捗を複製しない。

2026 catalogの`offering.method`実値は`correspondence`と`schooling`です。この機能では、`method: "schooling"`かつ構造化された`deliveryCategory`が厳密に`前期メディア`または`後期メディア`の開講だけをメディアスクーリングとして扱います。科目名の「メディア」文字列は判定に使いません。該当は128開講です。

PlannerStateはschemaVersion 5になり、`mediaSchoolingProgress: Record<string, MediaCourseProgress>`を追加しました。v4からのmigrationは既存の`items`、`publicCourses`、`thesisSelection`、`selectedScopeId`、`todos`、各itemの`earnedOrder`を保持し、進捗を空で初期化します。localStorage keyは従来どおり`hosei-planner:v1`です。

回数はcatalogに根拠データがないため固定しません。利用者が科目ごとに全回数を設定し、未設定のまま保存できます。動画とテストは独立したチェックです。全回数を減らす操作は、削除対象に完了データがある場合には拒否されます。

メディアタブの一覧は年間履修計画にある対象開講から毎回作られるため、追加・年度/期変更・削除・Undoを即時に反映します。削除された科目の進捗はorphanとして保存し、Undoまたは再追加時に復元します。明示的なクリーンアップUIはまだ設けず、少量の進捗データを安全に保持する方針です。

進捗は動画・テストの学習記録であり、PlannerItemのstatusや卒業要件の計算は変更しません。最終成績・単位修得との連携は後続機能で扱います。
