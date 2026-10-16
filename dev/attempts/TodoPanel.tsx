import { preventImeSubmit, text } from './formHelpers';
import { useState } from 'react';
import type { AttemptGraph, AttemptOwnedRecord } from '../../src/planner/attempts/types';
import { ownerLabel } from '../../src/planner/attempts/workbench/catalogView';
import { newOperationId, newRecordId, type Command } from '../../src/planner/attempts/workbench/operations';
import { buttonClass, Field, inputClass } from './Fields';

type Todo = Extract<AttemptOwnedRecord, { kind: 'todo' }>;
function ownerChoices(graph: AttemptGraph) {
  const choices = [{ key: 'none', label: 'ownerなし', owner: null as Todo['owner'] },
    ...graph.attempts.map(a => ({ key: a.id, label: `${a.originalTitle} / ${a.id} / ${a.membership.kind}`, owner: { kind: 'attempt' as const, attemptId: a.id } }))];
  for (const a of graph.attempts) for (const ref of a.legacyRefs) if (ref.entityKind === 'Offering' && !choices.some(c => c.key === `legacy:${ref.oldId}`)) {
    choices.push({ key: `legacy:${ref.oldId}`, label: `未解決旧Offering: ${ref.oldId}`, owner: { kind: 'unresolved_legacy', ref, reason: '本人が明示選択した未解決旧owner' } });
  }
  for (const r of graph.ownedRecords) if (r.owner?.kind === 'unresolved_legacy' && !choices.some(c => c.key === `legacy:${r.owner?.kind === 'unresolved_legacy' ? r.owner.ref.oldId : ''}`)) {
    choices.push({ key: `legacy:${r.owner.ref.oldId}`, label: ownerLabel(r.owner, graph), owner: r.owner });
  }
  return choices;
}
function TodoRow({ todo, graph, submit }: { todo: Todo; graph: AttemptGraph; submit: (command: Command) => boolean }) {
  const [owner, setOwner] = useState('keep');
  const choices = ownerChoices(graph);
  return <article className="space-y-3 rounded border p-3" aria-label={`TODO ${todo.payload.text}`}>
    <p className="break-all text-xs">{ownerLabel(todo.owner, graph)}</p>
    <form className="space-y-2" onKeyDown={preventImeSubmit} onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); submit({ kind: 'edit_payload', operationId: newOperationId(), recordId: todo.id, payload: { ...todo.payload, text: text(data, 'todo'), done: data.has('done') } }); }}>
      <Field label="TODO本文"><input className={inputClass} name="todo" defaultValue={todo.payload.text} /></Field>
      <label className="block"><input type="checkbox" name="done" defaultChecked={todo.payload.done} /> TODO完了</label>
      <button className={buttonClass}>TODOをメモリに反映</button>
    </form>
    <Field label="TODOの新owner"><select className={inputClass} value={owner} onChange={e => setOwner(e.target.value)}><option value="keep">現在のownerを維持</option>{choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
    <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={owner === 'keep'} onClick={() => {
      if (submit({ kind: 'assign_todo', operationId: newOperationId(), recordId: todo.id, owner: choices.find(c => c.key === owner)!.owner, expectedOwner: todo.owner })) setOwner('keep');
    }}>owner変更を明示実行</button><button className={buttonClass} onClick={() => submit({ kind: 'delete_todo', operationId: newOperationId(), recordId: todo.id })}>このTODOを削除</button></div>
    <p className="break-all text-xs">TODO ID: {todo.payload.id}</p>
  </article>;
}
export function TodoPanel({ graph, submit }: { graph: AttemptGraph; submit: (command: Command) => boolean }) {
  const choices = ownerChoices(graph);
  return <section className="space-y-3" aria-labelledby="todos-heading"><h2 className="text-xl font-bold" id="todos-heading">TODOとowner</h2>
    <form className="grid gap-2 rounded border bg-white p-3 sm:grid-cols-2" aria-label="TODO追加" onKeyDown={preventImeSubmit} onSubmit={e => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      if (submit({ kind: 'add_record', operationId: newOperationId(), record: { id: newRecordId(), kind: 'todo', owner: choices.find(c => c.key === text(data, 'owner'))!.owner,
        payload: { id: crypto.randomUUID(), text: text(data, 'text'), done: false } } })) e.currentTarget.reset();
    }}><Field label="新しいTODO"><input className={inputClass} name="text" required /></Field><Field label="追加先owner"><select className={inputClass} name="owner">{choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field><button className={buttonClass}>TODOを追加</button></form>
    {graph.ownedRecords.filter((r): r is Todo => r.kind === 'todo').map(todo => <TodoRow key={JSON.stringify(todo)} todo={todo} graph={graph} submit={submit} />)}
  </section>;
}
