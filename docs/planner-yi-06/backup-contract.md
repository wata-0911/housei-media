# 新旧backup・原文保護・復元

新形式は`hosei-attempt-backup` version1。envelopeはformat、backupVersion、UTC createdAt、schema23 state全文、envelope本体のcanonical SHA256だけを許す。stateに必要なcatalog・raw6・source原文・元版・割当・ledger・receipt・TODO ID履歴・Undo snapshotを含める。controllerが確認した**確定状態のみ**を出力する。未保存draftは別扱いで、その存在でバックアップが自動保存されることはない。

読み込みはstrict parser、closed envelope、日時、未来版、envelope SHA、同一ブラウザの確定履歴、source原版/全履歴replayの順。改変・欠損・duplicate key・不正owner・未知fieldを捨てず拒否する。SHAを再計算した偽造も、hostに確定記録がないため拒否する。元ファイルは変更しない。新backupのcreatedAtは形式と破損を検査する作成時刻で、第三者が証明した日時ではない。

復元は全件置換。プレビューで旧raw・新stateの件数/履歴/原情報を提示する。置換前rawとsource raw、日付訂正履歴を保護ファイルへ書き出し、保存先と比較内容の明示確認後にcommitする。同backupの再復元は同state/同ID/同数量になり、マージ・加算しない。host側の過去ID予約集合だけは減らさない。

旧`hosei-planner-backup` v1/v2は既存`parsePlannerBackup`/`restorePlannerBackup`からの通常v22復元を継続する。YI-06へは別の「旧原文を移行preview」からYI-04のdecoderを使う。backup.createdAt、公式原行、手動値、原版は元rawに保持する。旧backupの互換比較を緩めず、元state22でなければ拒否する。state1〜21の推測変換、未知原版の現catalog置換はしない。

`hosei-planner-protection` v1と`hosei-yi06-protection` v1はどちらも通常復元へ渡せない。後者は隔離state/sourceの原文を失わないための出力だけで、元v22 primary/recoveryを読むものではない。保護ファイルは暗号化されない。旧primary/recoveryは触らず、既存の保護経路も変更しない。

**DBを失った場合や別ブラウザでは、新backupだけから安全な再開はできない。** 原文・ID・receiptはファイルに保持されるが、履歴の真正性を証明するhost記録はファイルに含めない。外部ファイルが自己署名した鍵や証跡を受け入れる機能もない。ユーザーが「信頼する」にチェックするだけで未検証履歴を通す解除機能は提供しない。この可搬復旧の未対応はDraft PRのブロッカーであり、通常利用者向けbackupの完成とは報告しない。
