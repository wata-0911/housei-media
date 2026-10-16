# 独立監査P1修正：可搬復旧

Issue #175・Draft PR #176・既存featureブランチを継続。schema23と通常v22の境界は維持する。通常再読込と、利用者が選択したファイルからの復旧は別の権限契約とする。

## 信頼境界

| 経路 | 必要条件 | hostへの書込み |
| --- | --- | --- |
| 通常再読込 | hostに存在するcheckpoint SHA＋全整合性replay | なし。不明な履歴は拒否 |
| backup v2の可搬preview | 未信頼JSONのclosed shape、原版、raw6、割当、全receipt、参照・数量・全namespaceの整合性 | なし。DB作成もなし |
| 可搬commit | 上記再検証＋選択ファイル固有の採用確認＋選択ファイル/置換前raw/sourceの保護確認＋Lock/CAS | 単一transactionで一回put |
| 確認済みcheckpointへの復元 | 全整合性replay＋原文保護・全件置換確認 | 過去checkpoint・ID予約を減らさず一回put |
| 旧Attempt backup v1 | 従来どおり同一hostのcheckpointが必要 | v1は巻戻し後の全予約を収録していないため、空hostへの可搬復旧は拒否 |

ファイル内SHAは破損検出であり、発行者認証ではない。利用者は内部整合性を検証したファイルを復旧元として採用する。その判断は画面上の独立したチェック欄で行い、controllerには選択ファイル全文のSHAと保護した原文の一致を渡す。コピーしたpreview/handleや確認前handleの編集は拒否する。保存成功後だけ、そのhostの確認済みcheckpointとなる。

全内容を整合する別の履歴へ作り替えてSHAも再計算したファイルについて、実際にその人物が操作したか、誰が発行したかは証明できない。署名・秘密鍵・大学認証・外部authorityがあるとは表示しない。利用者の採用確認も暗号学的認証ではない。YI-04 WeakSetには再登録しない。

## backup v2とv1の扱い

`hosei-attempt-backup` version2は、version1のenvelopeへ`reservedIds`を加えた厳密な別版。全state、原版、raw6、割当、ledger、receipt、TODO履歴、Undo snapshotを保持し、さらにhostの全ID予約を保持する。過去backupへ戻した後に現在stateから消えているIDも含む。書出し時にhostをread-onlyで再取得するため、古いloaded handleで書き出しても既に確定した予約を落とさない。

`reservedIds`は将来の再利用を禁止する集合であり、発行者や過去要求の真正性を証明する記録ではない。stateに収録された全履歴IDと旧sourceのUUIDを必ず含める。空値・未知prefix・重複・namespaceを跨ぐ同一UUIDを拒否する。未使用予約も新しい発行と衝突できない。

旧version1には現在state外の予約が欠ける可能性があり、ファイルだけから補えない。同一hostでv1を読み、v2を書き出す経路は維持する。hostを失ったv1単体を「完全な予約履歴」と見なして通すことはしない。この互換制限は残る。旧`hosei-planner-backup` v1/v2のv22契約とは別。

## 検証と置換

1. 重複JSON key、未知field、未来版、日時、envelope SHAを検証する。
2. 実装に固定された信頼済み原版とraw6の実測SHAを確認する。ファイル内catalogや自己申告のdigestだけを信頼しない。復旧先のenvironmentとの一致も確認する。
3. sourceを再decodeし、元raw/数量/optional/配列順/metadataを照合する。元sourceから初期graph・retained・ledgerを再構築する。
4. 割当と訂正chainを確認する。予約、旧source、両catalog、全namespaceの衝突を調べる。旧TODO自体が別source entityのUUIDと衝突する場合も拒否する。
5. 全要求を順に再実行する。各新規operation/Attempt/record/TODO IDについて、source・両catalog・初期割当・未使用予約・過去receipt・削除済みIDとの衝突を検証する。最終graph・owner・retained・history・verificationを全field比較する。
6. 既存hostに未知のcheckpointを持ち込む場合、既存予約/現sourceのUUIDと重なる履歴は拒否する。自動的な同一性推定、branch合流、マージはしない。IDが重ならない全件置換は明示採用後に可能。
7. hostが既に確認した同一checkpointは巻戻し・反復復元できる。予約と過去checkpoint集合は常にunionし、減らさない。復元したstate自体のIDや数量は増殖させない。
8. commit直前に全stateを再検証し、共通Web Lock内でraw/revision/host履歴/予約をCASする。競合・quota・Lock非対応・SecurityErrorでは成功表示しない。

## 原子的な空DB初期化

previewは`indexedDB.databases()`のread-only確認だけで、DBを作らない。初回commitの`open(...,1)`では、`onupgradeneeded`の同じversionchange transaction内でstoreを作成し、CASし、一回putする。初期化とstate保存を別transactionにしない。失敗時はそのtransactionがabortし、空DBだけを残す補償書込みも行わない。既存DBは単一readwrite transactionで同じCAS/putを行う。

readonly openの間にDBが消えた場合はupgradeをabortして停止する。blockedで拒否したopenが後に進んでも保存しない。接続は各transaction終了時に閉じる。

## 脅威モデル・未対応

- 内部不整合、未知原版、欠落receipt、偽snapshot、不正Undo順、ID衝突、未対応版、競合、保存失敗を拒否する。
- 整合した偽造ファイルの発行者認証、同一originの悪意あるscript、DevTools/profile改ざん、利用者が誤ったファイルを採用することまでは防がない。
- 新backup v2は別profile/別originの空DBへ復旧できる。既存hostで未知の共有ID履歴が衝突する場合は空の隔離環境で復旧し、手動マージ機能は提供しない。
- v1単体かつ元host喪失では、state外予約の完全性を証明できず未対応。今後必要なら損失範囲を明示した別の移行契約を設計する。
- 32MiB上限、実ディスク枯渇試験未実施、Safari/iPhone・Files・Firefox・スクリーンリーダー・IME実機は未実施。Chromiumの独立BrowserContextは別profile相当であり、異なるブラウザ製品間の実機検証とは区別する。
- 一般公開、卒業計算adapter接続、Draft解除、merge、Issue closeはこの修正に含まない。
