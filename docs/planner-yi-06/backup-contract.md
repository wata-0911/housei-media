# 新旧backup・原文保護・復元

独立監査P1修正後の新規書出しは`hosei-attempt-backup` **version2**。envelopeはformat、backupVersion、UTC createdAt、schema23 state全文、`reservedIds`、envelope本体のcanonical SHA256のみ。stateにはcatalog・raw6・source原文・元版・割当・ledger・receipt・TODO ID履歴・Undo snapshotを含める。`reservedIds`にはhostの全予約を含め、rollbackで現在stateから消えたIDも持ち出す。確定状態のみを出力する。

version2は空の別profile/別originでも、対応実装と同じ信頼済み原版がある場合に復旧できる。strict parser、closed envelope、日時、未来版、SHA、固定原版、source、割当、全操作replay、全field/参照/数量、全namespace衝突を検証する。SHAを計算し直した不整合ファイルも拒否する。SHAは発行者認証ではなく、整合した別履歴を誰が作成したかは証明しない。

可搬previewは保存しない。画面で「発行者は未認証だが、このファイルを復旧元として採用する」と確認し、選択ファイル原文・置換前raw・元source・訂正履歴を保護し、全件置換確認を行う。commit時にファイル固有の採用/保護の一致を要求する。成功後だけ新hostでの再読込が可能になる。通常再読込のhost照合を解除しない。

既存DBでは未知の履歴と既存IDが重なる場合は拒否する。同一checkpointへの反復復元・過去checkpointへの巻戻しは許し、hostのID予約・過去checkpointはunionして保持する。マージや加算はしない。空DBは初期化とstate/host証跡を一つのversionchange transactionで保存し、既存DBは一つのreadwrite transactionでCASと一回putを行う。

旧Attempt backup **version1**は完全なhost予約を収録しなかったため、従来の同一host checkpoint照合を必要とする。元hostでv1を復元してv2を書き出せる。host喪失後のv1単体について欠けた予約を推測して完全な可搬backupと扱わない。

旧`hosei-planner-backup` v1/v2は既存の通常v22復元を継続する。YI-06へは別の「旧原文を移行preview」からYI-04 decoderで明示移行する。元createdAt・公式原行・手動値・原版・空白込みrawを保持する。state1〜21や未知原版を推測変換しない。

`hosei-planner-protection` v1と`hosei-yi06-protection` v1は通常復元へ投入できない。後者は原文保護専用で、選択backup原文も保存する。暗号化されず、通常primary/recoveryにはアクセスしない。

[可搬復旧の詳細・脅威モデル・互換制限](portable-recovery.md)、[P1受入記録](acceptance-p1.md)を参照。
