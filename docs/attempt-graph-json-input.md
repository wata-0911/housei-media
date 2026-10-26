# AttemptGraphのprimitive JSON入口（段階1）

`snapshotAttemptGraphJson(raw: string, context)` と `createWorkspaceJson(raw: string, context)` は、元からprimitive JSON文字列を持つ呼出し専用。runtimeでもstring以外を拒否し、coercion・toJSON・外部objectのstringify fallbackを行わない。既存object APIの入力範囲・capture・A2/N2/P3は変更しない。

反復scannerで資源・構文・表現を確認してから、reviverなしnative JSON.parseで最終構文判定する。新規parse treeはvalidation moduleが私有のままdeep freeze・表現登録し、同じtreeを既存schema・意味・context検証に渡す。公開結果は毎回別tree。registry・validator・一般objectを認証するhelperは公開しない。parser単体の出力は未認証の普通のtreeであり、source・ID発行・保存handle資格を持たない。contextは従来どおり信頼済み実行環境から渡し、本文のcontextを採用しない。

成功snapshotはdeep frozen graphを返す。既知入力失敗はgraphなしのissuesで返し、字句・表現・資源診断のpathは空文字。codeは `json_input_type`、`json_syntax`、`duplicate_json_key`、`unrepresentable_json_number`、`resource_limit`。資源診断にはbudget名と上限を含む。schema・意味診断は既存のcode/pathを使う。JSON.parseの呼出し位置だけでSyntaxErrorを構文診断へ変換し、その他の内部Error/cause identityはthrowのまま保持する。

Workspace入口は成功snapshotを直接使い、receiptsは空、usedTodoIdsはgraph内TODOのpayload.id順とし、全体をfreezeする。二重snapshotはしない。削除ticketを保持しても、この新規Workspaceに過去の操作receiptを捏造しないため、既存のUndo履歴証明要件は継続する。

| budget | inclusiveな上限と数え方 |
| --- | --- |
| rawBytes | 33,554,432 bytes（32MiB）。空白を含む原文のUTF-8長 |
| depth | 64。root containerが0、containerを入れ子にするたび+1。scalarはcontainer深度を増やさない |
| containers | 100,000。rootを含む全object/array |
| values | 1,000,000。root・container・scalarを含む全JSON値。keyは含めない |
| fields | 500,000。全objectのfield合計 |
| stringBytes | 8,388,608 bytes（8MiB）。decode後の単一key/value文字列 |
| totalStringBytes | 33,554,432 bytes（32MiB）。decode後の全key/value文字列の合計 |

UTF-8はTextEncoderと同じくsurrogate pairを4 bytes、孤立surrogateを置換相当の3 bytesとして数える。JS文字列の値自体は置換・正規化しない。raw.lengthは安価な下限検査にしか使わず、入力サイズのTextEncoder bufferは作らない。全token配列・再帰parserを作らず、container stackとobjectごとのdecoded key Setを使う。超過は切捨てや別APIへのfallbackなしで拒否する。上限は実端末での応答時間・ピークメモリ保証ではない。

同じ32MiBのraw制限とJSON構文の余分なbytesにより、totalStringBytes上限は公開APIでは先にraw制限へ到達する。合計budgetの境界テストだけは未認証の隔離scannerコピーでraw上限を上げて検証し、製品の上限値は変えない。このprofileはstate/backup/migrationへ流用しない。

duplicate keyはescape decode後の文字列でobjectごとに比較する。Unicode正規化は行わない。Number変換後の非有限数・全表記の-0（負underflowを含む）・unsafe integerを拒否する。通常小数丸め、正underflowの+0は現行migration契約と同じ。数値token原文とNumber値の完全同値を約束しない。旧object APIのfinite数受理とは別契約である。

null・0・省略・配列順・__proto__ own data・Unicodeを保持し、default/coercion/unknown削除/BOM除去は行わない。受け取ったrawを正規化した文字列で置換せず、呼出し元が原文を保持する。この入口はsource原文のdigestやauthorityを発行しない。

対象はGraph入口だけ。Worker、controller、schema23/24、backup v1/v2/v3、source parser、IDB/Lock/CAS、本番UI、全履歴replayを変更しない。新APIは既存UIへ接続しておらず、旧object cold captureと100 Command replayのP2は残る。段階1の検証成功はPR #183のReady化・dev統合・merge承認ではない。
