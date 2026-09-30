import type { GraduationProfile } from '../../planner/plannerCatalog';
import { GRADUATION_PROFILE_PREREQUISITE_LABEL, missingGraduationProfilePrerequisites, normalizeAdmissionYear, normalizeNonnegativeNumber } from '../../planner/graduationProfile';

export default function GraduationProfileSettings({ profile, disabled, onChange }: { profile: GraduationProfile; disabled: boolean; onChange: (profile: GraduationProfile) => void }) {
  const missing = missingGraduationProfilePrerequisites(profile);
  const update = (patch: Partial<GraduationProfile>) => onChange({ ...profile, ...patch });
  const updateRecognizedCredits = (key: keyof GraduationProfile['recognizedCredits'], value: string) => update({ recognizedCredits: { ...profile.recognizedCredits, [key]: normalizeNonnegativeNumber(value) } });

  return <section aria-labelledby="graduation-profile-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="graduation-profile-heading" className="text-xl text-[#002255]">卒業判定設定</h2>
    <p className="mt-3 border-l-4 border-sky-600 bg-sky-50 p-3 text-sm leading-relaxed">この情報は卒業要件の参考判定に使います。未入力の項目は推測せず、判定保留になります。</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">入学年度
        <input aria-label="入学年度" type="number" inputMode="numeric" min="1" step="1" value={profile.admissionYear ?? ''} disabled={disabled} onChange={event => update({ admissionYear: normalizeAdmissionYear(event.target.value) })} className="border border-gray-300 px-3 py-2" placeholder="例: 2025" />
        <span className="text-xs text-gray-600">現在年からは推測しません。</span>
      </label>
      <label className="grid gap-1 text-sm">入学区分
        <select aria-label="入学区分" value={profile.admissionType} disabled={disabled} onChange={event => update({ admissionType: event.target.value as GraduationProfile['admissionType'] })} className="border border-gray-300 px-3 py-2">
          <option value="unknown">未選択</option><option value="first_year">1年次入学</option><option value="transfer">編入学</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">認定単位
        <input aria-label="認定単位" type="number" inputMode="decimal" min="0" step="any" value={profile.recognizedCredits.totalCredits ?? ''} disabled={disabled} onChange={event => updateRecognizedCredits('totalCredits', event.target.value)} className="border border-gray-300 px-3 py-2" placeholder="0" />
        <span className="text-xs text-gray-600">入学前・編入時などの公式な認定単位。0単位も保存できます。</span>
      </label>
      <label className="grid gap-1 text-sm">認定単位のうちスクーリング相当（任意）
        <input aria-label="認定単位のうちスクーリング相当" type="number" inputMode="decimal" min="0" step="any" value={profile.recognizedCredits.schoolingEquivalentCredits ?? ''} disabled={disabled} onChange={event => updateRecognizedCredits('schoolingEquivalentCredits', event.target.value)} className="border border-gray-300 px-3 py-2" placeholder="公式な内訳がある場合のみ" />
        <span className="text-xs text-gray-600">公式に区別されている場合のみ入力してください。内訳は推測しません。</span>
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">適用課程
        <select aria-label="適用課程" value={profile.curriculumApplicability} disabled={disabled} onChange={event => update({ curriculumApplicability: event.target.value as GraduationProfile['curriculumApplicability'] })} className="border border-gray-300 px-3 py-2">
          <option value="unknown">未選択（確認が必要）</option><option value="current_2026">2026年度の現行課程</option><option value="legacy_or_transition">旧課程・経過措置・個別適用</option>
        </select>
        <span className="text-xs text-gray-600">入学年度から自動で確定しません。</span>
      </label>
    </div>
    {missing.length > 0 && <p className="mt-4 text-sm text-amber-800">判定前に確認が必要：{missing.map(key => GRADUATION_PROFILE_PREREQUISITE_LABEL[key]).join('、')}</p>}
  </section>;
}
