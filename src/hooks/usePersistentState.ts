import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { readRuntimeJson, writeRuntimeJson } from '../platform/runtimeStorage';

export function readPersistentValue<T>(key: string, fallback: T): T {
  return readRuntimeJson(key, fallback);
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
    // Persistence is intentionally routed through the runtime adapter so native
    // builds can replace browser storage without changing feature components.
    writeRuntimeJson(key, value);
  }, [key, value]);

  return [value, setValue];
}
