# スクーリング・リポート評価記録

## 評価と保存形式

評価は`S`、`A+`、`A`、`A-`、`B+`、`B`、`B-`、`C+`、`C`、`C-`、`D`の11段階で保存する。未入力は`null`で、画面では`A＋`、`A－`のように全角記号で表示する。

`PlannerState`はschemaVersion 6で、次を追加した。localStorage keyは従来どおり`hosei-planner:v1`である。

```ts
courseEvaluations: Record<string, {
  offeringId: string;
  reportGrade: CourseGrade | null;
  schoolingGrade: CourseGrade | null;
}>;
```

キーは`offeringId`である。現行のannual planは同一offeringを重複追加できず、catalogのoffering IDは年度・開講方法を含む一意の識別子である。そのため、同じ科目名の別開講や別年度予定へ評価を誤って共有しない。一度削除した科目の評価はorphanとして残し、同じofferingをUndoまたは再追加した場合だけ復元する。公開科目はcatalog offeringではないため対象外である。

v5からv6へのmigrationは評価を空で追加し、items、publicCourses、selectedScopeId、thesisSelection、earnedOrder、todos、mediaSchoolingProgressを保持する。

## catalog / source監査

2026 catalogは686 offeringsで不変である。`method`は`correspondence`または`schooling`として構造化されているため、スクーリング評価欄は`method: "schooling"`にのみ表示する。メディアスクーリングはこの集合の一部であり、既存の動画・テスト進捗と最終スクーリング評価を同じofferingに併存できる。進捗から成績は推定しない。

一方、catalogにはリポート対象かどうか、リポート回数、個別リポートの評価、または最終リポート評価を表す構造化フィールドがない。名称文字列で推測しないため、年間履修計画上の全catalog科目に手動の最終リポート評価欄を表示する。複数リポートの公式構造は今回の資料から確認できないため、複数回モデルは導入していない。単位修得試験の評価情報もcatalogにはなく、今回の対象外である。

## ステータスと将来の連携

評価の保存は`PlannerItem.status`、単位取得、卒業要件、GPAのいずれも変更しない。`S`でearned、`D`でfailedといった変換も行わない。成績確定時期やリポート・試験・スクーリングの単位修得条件を公式資料で契約化してから、将来のfeatureで明示的に連携する。
