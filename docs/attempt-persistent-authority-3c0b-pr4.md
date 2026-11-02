# 3C-0b PR4 永続保存接続

## 実装前照合（2026-11-02 JST）

開始HEAD: `cd4a6a4a331eb13d624b30fe7c9481e636856aba`。
その直接parent: `699d7efe09b40765be6ddaf09116dc51d083e196`。
作業branch: `feature/3c0b-pr4-persistent-authority-v2`。
PR base: `feature/attempt-3c0b-session-allocator-pr3`。
GitHubで#211/#210/#208/#206の指定HEAD、Draft/Open/未mergeを確認。
既存checkoutには未追跡3ファイルがあるため使用せず、新規cloneはcleanな固定HEADから開始。

詳細設計はrepositoryには存在せず、作業環境の
`design-reports/3c0-nested-uuid-81f9886-20261029/DESIGN.md` に実在。
SHA-256: `237f8d70507a20dc78afe799b7bbfac2a93be4e4735b1a141b29601d9a28d90e`。
#210監査の `references/DESIGN.md` とbyte digest一致。§3.2–3.5、§4.1–4.4、§5、§9を照合。
PR1/2/3、P1/P2、F03文書、YI-06 persistence/backup/portable-recovery、および指定主要コードを照合した。

| 論点 | 既存保証 | PR4で接続する機能 | 変更禁止境界 |
|---|---|---|---|
| Rule2 replay | H2/R2全値検証 | host読取・保存・export/restoreを同じcodecで検証 | 純粋foldの意味・順序変更禁止 |
| Session allocator | 生存session同期burn、private ticket | ownerの全予約とhost/R2のunion | UUID→検査→burn→ticket→返却、scope維持 |
| Authority v2 | strict純粋decoder、資格なし | 専用同期controllerのprivate handle/previewとhost再読込 | content validationと資格を分離 |
| Legacy preview | rule1検証後read-only candidate、2 fieldのみ差分 | source/全host snapshotに束縛した明示migration commit | 自動昇格禁止、held拒否、通常編集資格なし |
| Backup v4 | closed shape/digest/全値replay | 確定state export、inspect、選択ファイル確認後restore | SHAを発行者認証・host証跡と扱わない |
| IDB | DB v1、共通Lock、旧4 field CAS、同record一回put | record全field CAS、Lock内strict再読取、v2一回put | store/DB version/旧形式/原子性を破壊しない |

## 実装を開始する前に固定した判断

- 専用 `persistentSession.ts` を追加する。既存rule1 controller/syncSession/Workerは変更しない。
  PR3のidentity ownerを使用し、本人の実handle・最新Workspace・Command ticketへ束縛する。
  callerのcoverage/UUID/予約配列を受ける通常保存APIを設けない。
- 新規空hostからのnew-planだけnativeを開始できる。既存legacyをnew-planで洗浄しない。
  nativeの明示初期化も既存予約/checkpointを保持する。
- legacy→rule2の明示保存は許すがcoverageは元state canonical digestに固定。
  DESIGN §4.2/§9に従いlegacy-unprovenから通常編集保存資格を出さない。
  過去履歴の完全回復、legacy baseline合流・native昇格は未設計のためブロックする。
- portable v4は完全検証＋ファイル全文固有の保護/採用確認後のみ新hostのcheckpointになる。
  ファイルのnative宣言はissuer認証ではない。legacy→native/別baselineは純粋継続制約で拒否。
  旧v1/v2/v3は旧decoder/controllerによる読取・復元を維持し、PR4では移行分析を表示する。
  旧backupからrule2への直接adoptionは旧履歴資格を拡張するため接続しない。
- DB versionは1のまま。record形状だけ拡張する。新DB/key/journalや先行予約書込を追加しない。
  schema生成と初回putは既存同一versionchange transaction。失敗補償writeなし。
  CASはkey集合・raw/revision/committed/issuedIds/format/authorityVersion/coverage全値を比較する。
- commitはLock取得後にstrict readとsnapshot比較、再検証、atomic store CAS、一回put、commit完了、
  同じLock内で正規strict再読込まで待つ。書込後の読取失敗は成功を返さず `commit_outcome_unknown`。
  自動再送/rollbackなし。UIは明示reloadを案内する。
- protectCurrentは元storeのrawだけ読む独立救済経路。strict decoder、予約import、UUID発行を通さない。
- 開発UIは既存 `YI06_PERSISTENCE=1` のみ。production/3D/新write RPCへ接続しない。

以降に変更・RED/GREEN・ブラウザ・性能・未検証と引継ぎを追記する。
