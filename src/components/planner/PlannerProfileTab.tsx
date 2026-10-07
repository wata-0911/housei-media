import type { GraduationProfile, PlannerCatalog, ThesisProgress, ThesisSelection } from '../../planner/plannerCatalog';
import GraduationProfileSettings from './GraduationProfileSettings';
import ProfileBasicSettings from './ProfileBasicSettings';
import ProgramSettings from './ProgramSettings';

type Props = {
  catalog: PlannerCatalog;
  scopeId: string | null;
  profile: GraduationProfile;
  disabled: boolean;
  recognitionWarning?: string | null;
  thesis: ThesisProgress;
  onScopeChange: (scopeId: string | null) => void;
  onProfileChange: (profile: GraduationProfile) => void;
  onThesisSelectionChange: (selection: ThesisSelection) => void;
  onThesisStatusChange: (status: ThesisProgress['status']) => void;
};

export default function PlannerProfileTab(props: Props) {
  return <div className="space-y-6">
    <ProfileBasicSettings catalog={props.catalog} scopeId={props.scopeId} profile={props.profile} disabled={props.disabled} onScopeChange={props.onScopeChange} onProfileChange={props.onProfileChange} />
    <ProgramSettings
      catalog={props.catalog}
      scopeId={props.scopeId}
      thesis={props.thesis}
      disabled={props.disabled}
      onThesisSelectionChange={props.onThesisSelectionChange}
      onThesisStatusChange={props.onThesisStatusChange}
    />
    <GraduationProfileSettings profile={props.profile} catalog={props.catalog} scopeId={props.scopeId} disabled={props.disabled} recognitionWarning={props.recognitionWarning} heading="認定単位・卒業判定設定" hideBasicFields onChange={props.onProfileChange} />
    <section aria-labelledby="account-storage-heading" className="bg-white border border-gray-200 p-5 sm:p-7">
      <h2 id="account-storage-heading" className="text-xl text-[#002255]">アカウント・データ保存</h2>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">現在、履修計画やプロフィールはこのブラウザに保存されます。アカウント・クラウド保存は今後対応予定です。</p>
    </section>
  </div>;
}
