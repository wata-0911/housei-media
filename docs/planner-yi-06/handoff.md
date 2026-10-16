# YI-07/08と独立監査への引継ぎ

schema23・新backupは隔離開発用。通常のPlannerPage、v22 primary/recovery、卒業engineは継続。YI-06 mergeを一般公開の判断にしない。Ready化/merge/Issue closeは独立監査後にユーザーが判断する。

## 未完了・公開ブロッカー

- 同一origin/profileのhost確定履歴がある場合だけrehydrate/新backup復元できる。別端末・DB消失後の可搬復旧は未対応。外部発行authority等の信頼根を独立設計するまで解除しない。
- 現DBは同一originの悪意あるscript/DevTools/端末侵害への暗号学的耐性を提供しない。これはブラウザアプリの保存authorityとしての信頼境界。署名や大学認証と呼ばない。
- 32MiB上限、履歴増加、数秒の再検証、巨大graph/低速端末の負荷。履歴を削除して容量問題を隠さない。
- Safari/iPhone実機、Filesへ保存→再選択、スクリーンリーダー・IME実機は未実施。YI-08で実施し、未実施をPASSにしない。
- 既知#145の旧メディアdraft復元testは最新dev単体でも失敗。backup欄移動後の仕様に合わせた独立Issueを提案する。今回当該UI/testを修正・skipしない。

## P1監査重点

1. host確定checkpoint照合を通らず、shape/hashだけでJSON・発行表・偽receiptが保存権限を得る経路がないこと。注入storeの信頼境界を含む。
2. source raw/raw6/catalog実測、元版識別、公式aggregate/全retained/optional/配列順の完全保持。編集graphに旧source完全一致検査を流用しないこと。
3. IDB一回putのstate＋authority同時commit、Web Lock取得後CAS、quota/read/put/abort時原文不変、成功後のみloaded更新。再読込でauthorityが壊れた場合の停止。
4. production成果物のSHA一致、URL/直接module/無効flag/production serveゲート、通常v22 localStorageアクセス0。一般公開へのimportがないこと。

## P2監査重点

- 初期割当の再起動時再構成とYI-04 WeakSet非緩和。日付訂正chainの旧owner/assessment ID/原rawと全旧ID予約。
- LIFO Undoの複数削除順、receipt欠損/重複/順序改変、snapshot/previousPosition/owner/payload、detached進捗編集。
- rollback復元後も永久ID予約集合が縮まないこと。同操作再送no-opと同ID別内容拒否。
- 保護ファイル保存確認、長いIDと原文の390px表示、非同期中のdraft/loaded切替、pending preview取消の無副作用。
- 新backupの別format/version、旧v1/v2と保護形式の明示境界。createdAtを含むenvelope破損検出とhost証跡の役割の違い。

YI-07へ渡す場合も予定・希望方式・本人寄与を公式実績へ昇格しない。新graphから架空Offeringを作らない。`graduationCheckComplete=false`、`sourceLinksReverified=false`、unknown/ambiguous/conflict/unmatchedを維持。元source完全一致専用の旧projectionは編集後graphに使わない。
