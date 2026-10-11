import { useRef, useState, type InputHTMLAttributes, type Ref } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: string;
  onCommit: (value: string) => void | boolean | Promise<void | boolean>;
  normalize?: (value: string) => string;
  saveLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
};

/** Typing edits only a local draft. A changed persisted value (including restore)
 * invalidates the old draft; a failed write leaves its base value unchanged. */
export default function CommittedInput({ value, onCommit, normalize, saveLabel, disabled, inputRef, ...input }: Props) {
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const text = draft?.base === value ? draft.text : value;

  async function commit() {
    if (disabled || inFlight.current || composing.current || text === value) return;
    inFlight.current = true; setPending(true); setError('');
    try {
      const next = normalize ? normalize(text) : text;
      const result = next === value ? true : await onCommit(next);
      if (result === false) throw new Error('保存できませんでした。入力を保持しています。もう一度確定してください。');
      setDraft({ base: value, text: next });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした。入力を保持しています。もう一度確定してください。');
    } finally { inFlight.current = false; setPending(false); }
  }

  return <>
    <input {...input} ref={inputRef} value={text} disabled={disabled || pending}
      onChange={event => { setDraft({ base: value, text: event.target.value }); setError(''); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onBlur={event => {
        // Presets explicitly replace the draft; do not race their click with a
        // blur save of the previous text. Other blur targets confirm normally.
        const preset = event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-replaces-draft');
        if (!preset && (!saveButton.current || event.relatedTarget !== saveButton.current)) void commit();
      }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void commit(); } }} />
    {(saveLabel || error) && <button ref={saveButton} type="button" disabled={disabled || pending} onClick={() => { void commit(); }} className="border border-[#002255] px-3 py-2 text-sm disabled:opacity-50">{error ? '再試行' : saveLabel}</button>}
    {error && <span role="alert" className="mt-1 block text-xs text-red-700">{error}</span>}
  </>;
}
