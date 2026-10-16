import type { KeyboardEvent } from 'react';
export function preventImeSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
}
export const text = (data: FormData, key: string) => String(data.get(key) ?? '');
export const nullableText = (data: FormData, key: string, original?: string | null) => {
  const value = text(data, key);
  return value === (original ?? '') ? original ?? null : value || null;
};
