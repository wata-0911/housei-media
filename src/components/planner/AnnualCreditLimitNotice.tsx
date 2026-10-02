import type { AnnualCreditLimitReference } from '../../planner/annualPlan';

export default function AnnualCreditLimitNotice({ rows }: { rows: AnnualCreditLimitReference[] }) {
  return <section aria-labelledby="annual-credit-limit-heading" className="border border-amber-300 bg-amber-50 p-5 sm:p-7">
    <h2 id="annual-credit-limit-heading" className="text-xl text-[#002255]">年間履修上限（公式資料の参考表示）</h2>
    <p className="mt-2 text-sm text-gray-700">通信学習科目の修得単位数・スクーリング科目の登録単位数・卒業論文の合計は、1年間49単位までと案内されています。ここでは年度を設定した catalog 科目の既知単位だけを表示します。卒業論文は年度に紐付けていないため含めず、教職・資格科目も自動判定しません。</p>
    <p className="mt-2 text-sm text-gray-700">通信の修得済み履修が成績表の公式行に紐づく場合は、公式の修得単位を優先します。それ以外の通信は科目進捗への寄与単位を明示した場合にその単位数を、未設定の場合に開講単位を使用します。スクーリング登録は開講単位を使用します。</p>
    <p className="mt-2 text-sm text-gray-700">教職・資格科目を含む場合は合計60単位までと案内されていますが、スクーリング登録単位数は49単位までです。計画の保存や操作はこの参考表示で制限しません。</p>
    {rows.length === 0 ? <p className="mt-3 text-sm text-gray-600">年度を設定した科目がありません。</p> : <ul className="mt-4 space-y-2 text-sm">
      {rows.map(row => <li key={row.year} className={`border p-3 ${row.exceedsOfficial49 ? 'border-amber-500 bg-amber-100 text-amber-950' : 'border-amber-200 bg-white'}`}>
        <span className="font-medium">{row.year}年度：</span>{row.unknownCorrespondenceItems > 0 ? `通信 既知${row.correspondenceCredits}単位（未確定${row.unknownCorrespondenceItems}件）` : `通信 ${row.correspondenceCredits}単位`} + スクーリング登録 {row.schoolingRegistrationCredits}単位 = 既知合計 {row.knownTotalCredits}単位（{row.year > 2026 ? '2026年度ルールを参考表示・将来年度の上限は未確認' : '公式49単位の参考'}）
        {row.unknownCorrespondenceItems > 0 && <p className="mt-1">通信の修得単位が未確定の履修が{row.unknownCorrespondenceItems}件あります。{!row.exceedsOfficial49 && '既知合計だけでは49単位以内か確認できません。'}</p>}
        {row.exceedsOfficial49 && <p className="mt-1">{row.year > 2026 ? '2026年度の参考上限49単位を超えています。将来年度の上限と' : '49単位を超える見込みです。'}公式の登録・申請条件と個別の扱いを確認してください。この表示は保存や履修状態を変更しません。</p>}
      </li>)}
    </ul>}
  </section>;
}
