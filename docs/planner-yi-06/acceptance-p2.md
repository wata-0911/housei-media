# 追加P2：予約ID完全性の受入記録

Issue #175・Draft PR #176・`feat/yi-06-attempt-persistence`を継続。開始HEADは`c72746d1cf0415b027e127fc513e8ef2a6ee5dd3`、基準devは`a0fa267ca1acd4663c399da394552c46de366cbc`。新しいIssue/PR/ブランチは作成せず、Draft維持・未merge・Issue未close・一般公開なし。

## 修正と互換性

`requiredReservations`を明示し、全replayで確定した履歴IDと現在/全訂正前sourceのstate・旧catalog・制度catalogの全UUIDをunionする。新backupは現在hostの全予約も収録し、復元は必須予約の1件欠落でも拒否する。通常保存・復旧・巻戻しは同じ必須集合をhostの既存予約へunionする。namespaceが異なる同じUUID本体は衝突として拒否する。

catalogの必要部分集合だけを事前検査して欠落を早期拒否し、通過後は従来どおり完全な原版/source/割当/全操作replayを行う。YI-04 WeakSet、UUID発行境界、schema23/state replay版、通常v22/旧Planner backup契約は変更しない。

backupVersionは2を維持し、以前の開発用v2のうち必須予約が欠けるファイルは同一host/空hostの両方で拒否する。元hostの既知checkpointが残っていればread-only load→完全v2の再書出しが可能。load/書出しで自動保存せず、次の明示commitでhost予約も完全集合へunionする。元hostを失った不完全v2の直接復元は未対応。

## 追加回帰

- 正規backupに、旧sourceにも旧catalogにも現れない制度catalogだけのUUIDを含める。書出しによるhost/state/receipt変更や新規ID発行がないことを検証。
- source/catalog由来2,094 UUIDを1件ずつ外し、各envelope SHAを再計算して実際の`inspectBackup`で全件拒否した。対象実行は約20分。常設回帰では全2,094件の集合検査に、source全UUID・両catalogの先頭/末尾を外した実ファイルのSHA再計算・復元拒否を組み合わせ、毎回のCIへ約20分の反復を追加しない。全数の実API検証記録も保持する。
- 初期Attempt/operation/record、古いreceipt、削除TODO/record、未使用予約をそれぞれ外して拒否する。catalog UUIDを別namespaceへ置き換えた場合も拒否する。
- 空host可搬復旧→reload→別Attempt作成→過去backupへ巻戻しを行い、予約集合を保持し、後から発行したIDの再利用を拒否する。
- 訂正前source/割当/未使用予約も収録・欠落拒否を確認する。既存hostの共有catalog参照と未知の履歴衝突を区別し、既存の非重複置換/共有ID拒否試験を維持する。
- Chromiumでもcatalog等の欠落・namespace aliasをSHA再計算後に拒否し、空DBと旧v22原文を不変に保つ。A→B可搬復旧試験にreload後の新Attempt保存と予約保持を追加する。

## 最終結果

| 対象 | 最終ローカル結果 |
| --- | --- |
| Planner全回帰（YI-06 103件を含む） | 3,492 PASS / 0 FAIL / 0 SKIP |
| Attempt / migration / YI-05 UI / 原版 | 132 / 133 / 84 / 36 PASS |
| extension | 54 PASS / 0 FAIL / 0 SKIP |
| bookmarklet | 168 PASS / 0 FAIL / 0 SKIP |
| YI-06 Chromium | 17 PASS / 0 FAIL / 0 SKIP |
| YI-05 Chromium | 9 PASS / 0 FAIL / 0 SKIP |
| 既存Planner Chromium | 43 PASS / 1 FAIL / 0 SKIP |
| typecheck / lint / build / diff check / YI-01 verify | すべて成功 |

基準dev・通常build・開発flag付きproduction buildの全12path/SHA256が一致した。[p2-build-comparison.json](p2-build-comparison.json)。通常v22と既存browser testは差分なし。

機械可読記録は[p2-test-results.json](p2-test-results.json)。既知#145の旧Planner browser失敗は別件として記録し、skip/削除/期待値変更しない。P1以前の記録は履歴として保持する。

合成mixedのstateは従来どおり3,235,432 bytes。全予約2,105件を含むhost record JSONは3,723,487 bytes、backup v2は3,317,871 bytesで、32MiB上限内。[p2-capacity.json](p2-capacity.json)。実IndexedDBディスク割当量ではない。

初回の対象14件は10 PASS / 4 FAILだった。4件は衝突試験用の合成envelopeが制度catalog予約を欠き、新しい欠落検査で拒否されていた。fixtureに全必須予約を収録し、衝突の拒否assertを維持して関連10件を再実行し、全件成功した。初回失敗を削除せず機械可読記録に残す。

ローカルPlanner一括起動時は、まだ全2,094ファイルを実APIへ渡す版の欠落試験を含んでいた。その実行中に常設版の試験範囲を上記の組合せへ整理し、最終常設ケースを別途対象実行して成功した（全2,094件の集合検査＋SHA再計算した10ファイル、約30秒）。アプリコードは変更していない。最終HEADのCIは常設版を含む全suiteを対象とする。

## 保証範囲・未実施

[可搬復旧の脅威モデル](portable-recovery.md)を継続する。ファイル内SHAと利用者の明示採用は発行者認証ではない。state外の未知の過去予約がファイルから丸ごと消された場合、失われたhostなしにその事実を証明する外部authorityはない。収録された全state履歴/原版から導ける必須集合と、残るhost履歴を検証対象にする。

旧Attempt v1単体で元host喪失、未知の共有ID履歴のマージ、iPhone Safari/Files/Firefox/スクリーンリーダー/IME実機、実ディスク枯渇、巨大長期履歴/低速端末負荷は未対応または未実施。quotaは注入試験。YI-08の一般公開受入完了とは扱わない。
