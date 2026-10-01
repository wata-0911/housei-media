# Plannerの将来年の仮計画（schema v21）

## 大学からの回答（本機能の仕様根拠）

ユーザーが大学から得た回答として提供した内容を記録する。

- 『2026年度学習のしおり』pp.44〜59の教育課程表に掲載されたものが正式科目名。
- 正式科目名は原則年度で変わらない。ただしカリキュラム改正時には変更され得る。
- スクーリングは教育課程表の科目から年度ごとに選ばれ、開講科目は毎年変わる。
- 新年度のスクーリング開講予定は毎年2月に公開される。
- 予定一覧は確定情報ではない。実際の開講は『法政通信』各号で確認する。
- 担当教員がシラバスを作成し、テキスト・授業内容も科目ごとに決定する。

これらの回答は2027年以降の開講を保証しない。

## 仮計画の意味と制約

既存2026 Offeringを選び、`plannedYear` に履修したい暦年を保存する。
`offering.academicYear = 2026` と `plannedYear = 2027` は合法であり、
2027年度のOfferingが存在するという意味ではない。`plannedTerm` は本人の希望時期。
将来年の希望時期が未設定でも、2026 Offeringの開講期をその希望時期として表示しない。
方式・開講期・教員・シラバスは2026年度情報（参考）。将来の開講は未確認。
単位・区分・卒業要件の対応も2026課程を参考にし、改正時は再確認する。
年間49/60単位ルールは2026年度資料の参考であり、将来年度の公式上限とは扱わない。

予定のままの科目は修得単位・卒業要件充足・卒論指導の資格単位に加算しない。
既存の履修状態と計算ルールは変更しない。新科目や翌年の開講を推測しない。
保存形式・schema v21・Offering参照を維持し、migrationやannual catalog architectureを追加しない。

## dev監査結果と最小変更

起点: dev `8e9632b`。v22 branchの参照・取り込みなし。

- PlannerItemのplannedYearは既存validationで1000〜9999を許容。v21保存・reloadも将来年を保持。
- PlannedCourseListのYearInputは自由な4桁入力。今回は既存の西暦正規化を使い、0000等を保存前に拒否。
- studyYearは1〜4の履修学年。CourseSearchの履修可能学年フィルタも暦年とは独立。
- CourseSearch追加時のplannedYear=2026は維持。追加後に希望する西暦を編集できる旨を表示。
- Plan tableは履修学年ごとの表示。desktop/mobile双方の将来年科目に仮計画と2026参考の注記。
- annualPlanはplannedYearごとの集計が既存で機能。集計式は維持し、将来年の上限表示に2026参考の注記。
- plannerItemStateはOffering IDを保持してpatchを適用するだけ。変更不要。
- planner exportは元からplannedYear/plannedTermを保持。CSV/画像の区分表示に仮計画注記、画像にも計画年を表示。
- 通信・メディア・評価UIは予定時期未設定時にOffering.periodへfallbackしていた。将来年のみ希望時期未設定と表示し、参考情報の注記を追加。
- graduationProgress、earned、認定単位、指導資格、卒論、repeatable、History/Geographyの計算は変更不要。
- public courses、imported grades、extension handoff、storageの実装は維持。
