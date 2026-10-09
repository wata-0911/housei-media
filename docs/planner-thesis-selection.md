# 卒論選択: catalog監査（2026）

`planner_catalog_2026.json` の `conditions.when.thesis_selected` を全件監査した。該当は9 ruleであり、catalog本体は変更していない。

| scope | true条件 | false条件 | 数値要件 | required_course | includes_thesis |
| --- | --- | --- | --- | --- | --- |
| 法学部 / 法律学科 (`e31201f3-4f1d-432a-906e-6af94af294c9`) | `law_elective_with_thesis_min_credits`、`law_total_with_thesis_min_credits`、`law_thesis_guidance_required_course` | `law_elective_without_thesis_min_credits`、`law_total_without_thesis_min_credits` | true: 選択 50、専門教育 82 / false: 選択 54、専門教育 86 | true: 卒業論文一般指導 | `law_elective_with_thesis_min_credits` のみ true |
| 経済学部 / 経済学科 (`3641eb3c-91bd-4094-a56e-6e0f0da660f5`) | `economics_thesis_plan_required_course`、`economics_thesis_interim_required_course` | なし | なし | true: 卒業論文計画書指導、卒業論文中間報告書指導 | なし |
| 経営学部 / 商業学科 (`6609ce7c-3d7a-423e-9f19-7841dd841ca9`) | `commerce_thesis_plan_required_course`、`commerce_thesis_interim_required_course` | なし | なし | true: 卒業論文計画書指導、卒業論文中間報告書指導 | なし |

## 当初の実装方針（全scope対応前の記録）

- 卒論UIを出すのは、structured ruleで true と false の両方が確認できるscopeだけ。現行catalogでは法律学科のみ。
- 経済学科・商業学科は true条件の指導科目だけで、false分岐や数値要件がない。卒論なしを推測・自動判定しない。
- 法律学科では state の未定時に分岐要件を保留する。`selected` はtrue rule、`not_selected` はfalse ruleだけを評価し、対象外ruleは要件リスト・カードともに表示しない。
- `includes_thesis` は選択branchのcatalog注記として保持し、別の単位計算へ拡張しない。


## 現行実装との整合・Issue #54 / #55（2026-10-09）

上記はcatalogの数値分岐だけを対象にした当初の方針。現行の `thesisPolicyForScope()`、既存テスト `thesis policy distinguishes optional, required, and unknown scopes`、[全scope監査の学科別表](planner-thesis-rules-all-scopes.md) は、法律・経済・商業を選択制としている。今回この既存policyを変更しない。経済・商業の選択UIは法律の数値分岐を流用する根拠ではない。

- 選択制の `not_selected` は卒論カードを生成しない。0単位の `satisfied` カードは対象外を達成と表示していたため廃止する。`selected` は通常の進捗、`undecided` は既存の保留カードを維持する。
- 指導手続きは `thesisProgressForScope()` の正規化済み選択が `selected` のときだけ表示する。必修学科は常に選択相当。未定時は既存カード・プロフィールの選択UIを用い、警告を追加しない。
- 非表示は描画条件のみ。`thesisGuidanceByScope` のステータス・合格日・地理調査法リポート記録を削除せず、学科変更・保存復元・再選択で保持する。非選択時に卒論単位の `ThesisProgress.status` を未着手へ戻す既存正規化とは独立する。
- `requirements` は既存の条件分岐で対象外ruleを除外し、`unknownCount` / `unknownReasons` はその集合を集計する。`coverageSummary` は実際の `cards` の集合を集計するため、除外した卒論を判定済み1件として残さない。
- 単位計算・指導条件・60/80/100単位ゲートは変更しない。法律の50/54・82/86、全体参考124/128、未定時の既知数量と未確定targetの分離を維持する。経済・商業の専門82・全体参考124、文学部必修8単位と重複防止・80＋部分修得2の特例候補も既存仕様のままとする。

テストは `tests/planner.test.mjs` の `#54`（純粋判定・実ページ描画・保存復元）と `#55`（カード・必修正規化・集計）、`tests/graduation-audit.test.mjs` の `#55`（公式O4/S2とPlanner重複・単位分岐）に分離する。
