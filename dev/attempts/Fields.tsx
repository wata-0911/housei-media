import { cloneElement, useId, type ReactElement } from 'react';
export const inputClass = 'mt-1 block w-full rounded border border-slate-400 bg-white p-2 text-slate-900';
export const buttonClass = 'rounded bg-indigo-700 px-3 py-2 text-white hover:bg-indigo-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
export function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return <div className="min-w-0 text-sm font-medium text-slate-700"><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>;
}
const grades = ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
export function Grade({ label, name, value, report = false }: { label: string; name: string; value: string | null; report?: boolean }) {
  return <Field label={label}><select className={inputClass} name={name} defaultValue={value ?? ''}><option value="">未評価 (null)</option>{grades.filter(g => !report || g !== 'D').map(g => <option key={g}>{g}</option>)}</select></Field>;
}
