import { useState } from 'react';
import type { Attempt } from '../../../planner/attempts/types';

export function RecordedContributionForm({ attempt, disabled, save }: {
  attempt: Attempt; disabled: boolean; save: (raw: string) => boolean;
}) {
  const [error, setError] = useState('');
  const current = attempt.plan?.contribution?.value;
  return <form aria-label={`${attempt.originalTitle}の本人記録単位`} onSubmit={e => {
    e.preventDefault();
    if (disabled) return;
    const raw = String(new FormData(e.currentTarget).get('credits') ?? '').trim();
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && (!/^\d+(?:\.\d+)?$/.test(raw) || value === null || !Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER)) {
      setError('単位数は0以上の数値、または空欄で入力してください。'); return;
    }
    setError(''); save(JSON.stringify({ value }));
  }}><fieldset disabled={disabled}><legend>本人記録の単位数</legend>
      <p>公式成績とは別の本人入力です。空欄は不明、0は明示的な0単位です。修得済みの記録だけが条件付き計算の対象です。</p>
      <label>単位数（空欄は不明）<input key={`${attempt.id}:${String(current)}`} name="credits" inputMode="decimal" defaultValue={current ?? ''} /></label>
      <p>記録中の値: {current === null ? '不明（null）' : current === undefined ? '未入力' : `${current}単位`}</p>
      <button>単位数を下書きに反映</button>
    </fieldset>{error && <p role="alert">{error}</p>}</form>;
}
