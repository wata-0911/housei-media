import type { GraduationProfile, PlannerCatalog } from '../../planner/plannerCatalog';
import GraduationProfileSettings from './GraduationProfileSettings';
import ProfileBasicSettings from './ProfileBasicSettings';

type Props = {
  catalog: PlannerCatalog;
  scopeId: string | null;
  profile: GraduationProfile;
  disabled: boolean;
  recognitionWarning?: string | null;
  onScopeChange: (scopeId: string | null) => void;
  onProfileChange: (profile: GraduationProfile) => void;
};

export default function PlannerProfileTab(props: Props) {
  return <div className="space-y-6">
    <ProfileBasicSettings catalog={props.catalog} scopeId={props.scopeId} profile={props.profile} disabled={props.disabled} onScopeChange={props.onScopeChange} onProfileChange={props.onProfileChange} />
    <GraduationProfileSettings profile={props.profile} catalog={props.catalog} scopeId={props.scopeId} disabled={props.disabled} recognitionWarning={props.recognitionWarning} heading="認定単位・卒業判定設定" hideBasicFields onChange={props.onProfileChange} />
    <section aria-labelledby="account-storage-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
      <h2 id="account-storage-heading" className="text-xl text-[#002255]">アカウント・データ保存</h2>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">現在、履修計画やプロフィールはこのブラウザに保存されます。アカウント・クラウド保存は今後対応予定です。</p>
    </section>
  </div>;
}
