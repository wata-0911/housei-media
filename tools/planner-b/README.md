# B専用固定ルートとループバック検証

固定mainを祖先に持つcheckoutと、固定devのGitオブジェクトを使う。履歴取得を先に済ませる。materializerはネットワークへ接続せず、固定devと圧縮/展開patchの長さ・SHA、生成tree、追跡path・mode・blob、lockを検証する。存在しない物理ディレクトリをA rootの外に指定する。固定オブジェクトが得られない場合は依存導入前に停止する。

```sh
node tools/planner-b/materialize.mjs b70 /absolute/work/b70
node tools/planner-b/materialize.mjs b59 /absolute/work/b59 /absolute/work/b70
node tools/planner-b/build.mjs install /absolute/work/b70 b70
node tools/planner-b/build.mjs install /absolute/work/b59 b59
node tools/planner-b/build.mjs quality /absolute/work/b70
node tools/planner-b/build.mjs split /absolute/work/b70 /absolute/work/b-dist
node tools/planner-b/build.mjs history-cold /absolute/work/b59 /absolute/work/b59-cold
```

各実行root・出力先・その親ディレクトリを信頼済みジョブに専有させる。ジョブ間でAのsrcやnode_modulesを共有しない。Bの依存は版ごとのrootで固定lockから導入し、rootとNode版、依存実体の照合結果を記録する。品質試験・buildの直前に全sourceを再照合し、余分な入力、依存の不一致、既存出力先を拒否する。パッケージ取得に必要なproxy/CAは導入時に限り渡す。ビルドは一時出力の全path/bytes/SHA256を検査してから移す。

`split` は4178の17資産、`cold` は4179、`history` は旧writerの4178、`history-cold` は旧writerの4180を使う。出力の利用目的とpinは別。既存8系統の `browser` はNode22とPlaywright1.62.1を要求する。stock runner内部では固定B59を別作業領域に展開し、実lock一致の確認後にB70依存を使う。保護ブラウザ試験に渡すB59 coldはB59で個別にnpm ciしたもの。

`startLocalGate` は既定OFFのループバック専用。明示した合成HTTP Basic資格情報でHTMLと資産をGET/HEADの両方で保護し、ホストと17資産の実体を照合する。テスト専用であり、利用者データを置かない。実サービスでは別途本人認証、対象originと全aliasの保護、先行タブ停止、版別復元の確認が必要。

`.github/workflows/ci.yml` の候補は既存A jobを保持し、B通常/Bブラウザを専用ジョブで追加する。既存 `check` は3ジョブすべてのsuccessを要求する。ローカル検証の記録はB74に格納。実GitHub Actions、ブランチ保護および配備の設定は別判定。

B更新時は承認済み原本patchとbase/patch/tree/lock/資産pinを一緒に更新する。生成root、dist、個人データ、資格情報は追跡しない。

## B76 candidate

Materialize the archive candidate with `node tools/planner-b/materialize.mjs b76 ABSOLUTE_NEW_ROOT`.
Pass the trailing argument `b76` for all build and test modes using that root. The
wrapper verifies the fixed tree and lock before installation or use, seals a
separate dependency installation, and checks the split and cold asset pins.
The historic B70 and B59 inputs and the existing B72 gate checks still use their
fixed roots. Browser jobs run the inherited suites and the registered schema27
suite from the B76 root. No deployment step is part of this candidate.

## B78 protected browser candidate

Materialize and install B78 separately with the explicit b78 variant. Generate
its split and cold outputs once at ports 4178 and 4179 through the build
wrapper. Materialize B59 from fixed B70 and install it from its own verified
lock. Its history build uses port 4178 and the older cold control uses 4180.

The browser command for b78 takes four additional absolute paths after the
Playwright package and evidence arguments: B78 split output, B78 cold output,
B59 source, and B59 history output. The runner uses those same directories.
Before each registered suite, verify-browser checks both source trees and
dependency seals plus every asset's path, size and digest across all three
outputs. A failure is recorded and applies to the overall exit status. The next
suite must pass the check again before it can start.

Local gate variants b78-split and b78-cold are explicit. The existing b70-split
variant remains the default for the older gate tests. Unknown variants and
different versions of the distribution fail before listening. Only loopback
tests use these gates. Verification at test boundaries does not guarantee
isolation from a malicious process running under the same OS user.
