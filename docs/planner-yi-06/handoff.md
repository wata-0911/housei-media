# YI-07/08と独立監査への引継ぎ

schema23・新backupは隔離開発用。通常のPlannerPage、v22 primary/recovery、卒業engineは継続。YI-06 mergeを一般公開の判断にしない。Ready化/merge/Issue closeは独立監査後にユーザーが判断する。

## 未完了・公開ブロッカー

- P1修正でbackup v2の空hostへの可搬復旧を実装。通常再読込のhost照合と、全整合性検証＋利用者の明示採用を分離した。旧Attempt backup v1単体のhost喪失時は予約履歴不足で未対応。未知の共有ID履歴の合流・マージは未対応。
- 現DBは同一originの悪意あるscript/DevTools/端末侵害への暗号学的耐性を提供しない。これはブラウザアプリの保存authorityとしての信頼境界。署名や大学認証と呼ばない。
- 32MiB上限、履歴増加、数秒の再検証、巨大graph/低速端末の負荷。履歴を削除して容量問題を隠さない。
- Safari/iPhone実機、Filesへ保存→再選択、スクリーンリーダー・IME実機は未実施。YI-08で実施し、未実施をPASSにしない。
- 既知#145の旧メディアdraft復元testは最新dev単体でも失敗。別件として失敗を記録し、今回当該UI/testを修正・skipしない。新しいIssueは作成しない。

## P1監査重点

1. 通常再読込のhost照合を維持し、可搬復旧だけが全原版/履歴/namespace検証＋ファイル固有の採用/保護確認を経て新checkpointを作ること。SHAや同意を発行者認証と表示しないこと。
2. source raw/raw6/catalog実測、元版識別、公式aggregate/全retained/optional/配列順の完全保持。編集graphに旧source完全一致検査を流用しないこと。
3. 空DBのschema初期化も同じversionchange transactionに含めたIDB一回putのstate＋authority同時commit、Web Lock取得後CAS、quota/read/put/abort時原文不変、成功後のみloaded更新。再読込でauthorityが壊れた場合の停止。
4. production成果物のSHA一致、URL/直接module/無効flag/production serveゲート、通常v22 localStorageアクセス0。一般公開へのimportがないこと。

## P2監査重点

- 追加P2では必須予約集合を現在/全訂正前source・両catalog・全履歴から明示計算し、v2の完全収録を要求する。旧開発用v2の欠落はSHA再計算後も拒否し、元hostが残る場合の再書出しだけを案内する。[受入記録](acceptance-p2.md)。
- 初期割当の再起動時再構成とYI-04 WeakSet非緩和。日付訂正chainの旧owner/assessment ID/原rawと全旧ID予約。
- LIFO Undoの複数削除順、receipt欠損/重複/順序改変、snapshot/previousPosition/owner/payload、detached進捗編集。
- rollback復元後も永久ID予約集合が縮まないこと。同操作再送no-opと同ID別内容拒否。
- 保護ファイル保存確認、長いIDと原文の390px表示、非同期中のdraft/loaded切替、pending preview取消の無副作用。
- 新backup v2、旧Attempt v1、旧Planner v1/v2と保護形式の明示境界。createdAtを含むenvelope破損検出とhost証跡の役割の違い。

YI-07へ渡す場合も予定・希望方式・本人寄与を公式実績へ昇格しない。新graphから架空Offeringを作らない。`graduationCheckComplete=false`、`sourceLinksReverified=false`、unknown/ambiguous/conflict/unmatchedを維持。元source完全一致専用の旧projectionは編集後graphに使わない。
