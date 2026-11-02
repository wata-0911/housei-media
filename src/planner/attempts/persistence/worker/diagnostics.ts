import type {Diagnostic} from '../../migration/contracts';

/** Only stable blocker kinds cross into display data. Never copy the internal
 * error code, path, stack, source text, or any unbounded caller value. */
export function rule2Diagnostics(blockers:readonly {kind:string}[]):readonly Diagnostic[] {
 return Object.freeze(blockers.map(blocker=>{
  const code=blocker.kind==='prohibited-rule2-introduction'?'rule2_prohibited_introduction'
   :blocker.kind==='uuid-namespace-collision'?'rule2_uuid_collision':'rule2_evidence_insufficient';
  const message=code==='rule2_prohibited_introduction'?'新規identityをrule2へ移行できません。'
   :code==='rule2_uuid_collision'?'UUIDのnamespaceに衝突があります。':'rule2移行に必要な証拠が不足しています。';
  return Object.freeze({code,path:'/',message});
 }));
}
