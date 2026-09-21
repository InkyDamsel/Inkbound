import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import {
  INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT,
  readRuntimeJson,
  writeRuntimeJson,
} from '../platform/runtimeStorage';

export function readPersistentValue<T>(key: string, fallback: T): T {
  return readRuntimeJson(key, fallback);
}

export function usePersistentState<T>(
  key: string,
  fallback: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const fallbackRef = useRef<T>(fallback instanceof Function ? fallback() : fallback);
  const [value, setValue] = useState<T>(() => readPersistentValue(key, fallbackRef.current));
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
    // A fallback is presentation state, not user intent. Never persist it merely
    // because a screen mounted: account-owned defaults could otherwise become a
    // fresh local mutation and overwrite real cloud data during hydration.
    // Actual edits are persisted synchronously by setPersistentValue below.
  }, [value]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const refreshFromRuntimeStorage = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key !== key) return;
      const nextValue = readPersistentValue(key, fallbackRef.current);
      valueRef.current = nextValue;
      setValue(nextValue);
    };

    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, refreshFromRuntimeStorage);
    return () => window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, refreshFromRuntimeStorage);
  }, [key]);

  const setPersistentValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    const resolved = nextValue instanceof Function
      ? (nextValue as (previous: T) => T)(valueRef.current)
      : nextValue;

    // Persist synchronously at the mutation boundary instead of waiting for a
    // later React effect. Mobile apps can background or navigate immediately after
    // a tap, so this prevents the newest local change from being lost before the
    // component lifecycle has a chance to flush an effect.
    valueRef.current = resolved;
    writeRuntimeJson(key, resolved);
    setValue(resolved);
  }, [key]);

  return [value, setPersistentValue];
}
