import {useState, type Dispatch, type SetStateAction} from 'react';

// Recovery is scoped to this tab and authenticated session, never an access credential.
export function readDraft<T>(key: string | null, fallback: T, storage?: Pick<Storage, 'getItem'>): T {
  try { return key ? JSON.parse((storage ?? sessionStorage).getItem(`study-v1:${key}`) || 'null') ?? fallback : fallback; }
  catch { return fallback; }
}
export function writeDraft(key: string | null, value: unknown, storage?: Pick<Storage, 'setItem'>) {
  try { if (key) (storage ?? sessionStorage).setItem(`study-v1:${key}`, JSON.stringify(value)); }
  catch { /* Storage can be unavailable; server saves still operate normally. */ }
}
export function useSessionDraft<T>(key: string | null, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readDraft(key, typeof initial === 'function' ? (initial as () => T)() : initial));
  const update: Dispatch<SetStateAction<T>> = next => setValue(previous => {
    const result = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
    writeDraft(key, result);
    return result;
  });
  return [value, update];
}
