import { Dispatch, SetStateAction, useEffect, useState } from 'react';

export function readPersistentValue<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : (JSON.parse(stored) as T);
  } catch {
    return fallback;
  }
}

export function usePersistentState<T>(
  key: string,
  fallback: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const resolvedFallback = fallback instanceof Function ? fallback() : fallback;
    return readPersistentValue(key, resolvedFallback);
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can fail in private browsing or when image data exceeds quota.
    }
  }, [key, value]);

  return [value, setValue];
}
