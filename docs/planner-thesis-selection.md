# 卒論選択: catalog監査（2026）

`planner_catalog_2026.json` の `conditions.when.thesis_selected` を全件監査した。該当は9 ruleであり、catalog本体は変更していない。

| scope | true条件 | false条件 | 数値要件 | required_course | includes_thesis |
| --- | --- | --- | --- | --- | --- |
| 法学部 / 法律学科 (`e31201f3-4f1d-432a-906e-6af94af294c9`) | `law_elective_with_thesis_min_credits`、`law_total_with_thesis_min_credits`、`law_thesis_guidance_required_course` | `law_elective_without_thesis_min_credits`、`law_total_without_thesis_min_credits` | true: 選択 50、専門教育 82 / false: 選択 54、専門教育 86 | true: 卒業論文一般指導 | `law_elective_with_thesis_min_credits` のみ true |
| 経済学部 / 経済学科 (`3641eb3c-91bd-4094-a56e-6e0f0da660f5`) | `economics_thesis_plan_required_course`、`economics_thesis_interim_required_course` | なし | なし | true: 卒業論文計画書指導、卒業論文中間報告書指導 | なし |
| 経営学部 / 商業学科 (`6609ce7c-3d7a-423e-9f19-7841dd841ca9`) | `commerce_thesis_plan_required_course`、`commerce_thesis_interim_required_course` | なし | なし | true: 卒業論文計画書指導、卒業論文中間報告書指導 | なし |

## 実装方針

- 卒論UIを出すのは、structured ruleで true と false の両方が確認できるscopeだけ。現行catalogでは法律学科のみ。
- 経済学科・商業学科は true条件の指導科目だけで、false分岐や数値要件がない。卒論なしを推測・自動判定しない。
- 法律学科では state の未定時に分岐要件を保留する。`selected` はtrue rule、`not_selected` はfalse ruleだけを評価し、対象外ruleは要件リスト・カードともに表示しない。
- `includes_thesis` は選択branchのcatalog注記として保持し、別の単位計算へ拡張しない。
