import { useState } from 'react';
import type { GraduationProfile, PlannerCatalog } from '../../planner/plannerCatalog';
import { selectablePrograms } from '../../planner/annualPlan';
import { graduationProfileValidationError, normalizeAdmissionYear } from '../../planner/graduationProfile';

type Props = {
  catalog: PlannerCatalog;
  scopeId: string | null;
  profile: GraduationProfile;
  disabled: boolean;
  onScopeChange: (scopeId: string | null) => void;
  onProfileChange: (profile: GraduationProfile) => void;
};

export default function ProfileBasicSettings({ catalog, scopeId, profile, disabled, onScopeChange, onProfileChange }: Props) {
  const [admissionYearDraft, setAdmissionYearDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const programs = selectablePrograms(catalog);
  const legacyCommon = catalog.programs.find(program => program.scopeId === scopeId && program.isCommon);

  const updateProfile = (next: GraduationProfile) => {
    const message = graduationProfileValidationError(next);
    if (message) { setError(message); return; }
    setError(null);
    onProfileChange(next);
  };

  const commitAdmissionYear = () => {
    const raw = admissionYearDraft ?? (profile.admissionYear === null ? '' : String(profile.admissionYear));
    const admissionYear = normalizeAdmissionYear(raw);
    if (raw.trim() && admissionYear === null) {
      setError('入学年度は4桁の西暦（1000〜9999）で入力してください。変更は保存していません。');
      return;
    }
    setAdmissionYearDraft(null);
    updateProfile({ ...profile, admissionYear });
  };

  return <section aria-labelledby="profile-basic-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
    <h2 id="profile-basic-heading" className="text-xl text-[#002255]">基本情報</h2>
    <p className="mt-2 text-sm text-gray-600">所属と入学情報は、科目の区分表示・卒業要件・卒論手続の判定に共通して使用します。</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label htmlFor="profile-program-scope" className="grid gap-1 text-sm">所属学科
        <select id="profile-program-scope" aria-label="所属学科" value={legacyCommon ? '' : scopeId ?? ''} disabled={disabled} onChange={event => onScopeChange(event.target.value || null)} className="min-w-0 border border-gray-300 bg-white p-2 disabled:opacity-50">
          <option value="">所属を選択してください</option>
          {[...new Set(programs.map(program => program.faculty))].map(faculty => <optgroup key={faculty} label={faculty ?? '学部未設定'}>
            {programs.filter(program => program.faculty === faculty).map(program => <option key={program.scopeId} value={program.scopeId}>{program.displayName}</option>)}
          </optgroup>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">入学年度
        <input aria-label="入学年度" type="number" inputMode="numeric" value={admissionYearDraft ?? (profile.admissionYear === null ? '' : String(profile.admissionYear))} disabled={disabled} onChange={event => setAdmissionYearDraft(event.target.value)} onBlur={commitAdmissionYear} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitAdmissionYear(); } }} className="border p-2" />
      </label>
      <label className="grid gap-1 text-sm">現在の在学年次
        <select aria-label="現在の在学年次" value={profile.currentStudyYear ?? ''} disabled={disabled} onChange={event => updateProfile({ ...profile, currentStudyYear: event.target.value === '' ? null : Number(event.target.value) as 1 | 2 | 3 | 4 })} className="border p-2">
          <option value="">未設定</option><option value="1">1年次</option><option value="2">2年次</option><option value="3">3年次</option><option value="4">4年次</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">入学区分
        <select aria-label="入学区分" value={profile.admissionType} disabled={disabled} onChange={event => updateProfile({ ...profile, admissionType: event.target.value as GraduationProfile['admissionType'] })} className="border p-2">
          <option value="unknown">未選択</option><option value="first_year">1年次入学</option><option value="transfer_second_year">2年次編入</option><option value="transfer_third_year">3年次編入</option><option value="bachelor_admission">学士入学</option><option value="hosei_internal_transfer">法政内部等（個別認定）</option><option value="other_transfer">その他・個別認定</option>
        </select>
      </label>
    </div>
    <p className="mt-3 text-sm text-gray-600">所属学科を変更しても、学科ごとの卒業論文進捗は保持されます。すべての開講科目を引き続き検索・追加できます。</p>
    {legacyCommon && <p className="mt-2 text-sm text-amber-800">以前の共通scope設定を保持しています。区分別集計を表示するには所属学科を選択してください。</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
  </section>;
}
