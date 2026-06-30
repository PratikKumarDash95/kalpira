'use client';

import { Dispatch, SetStateAction, useEffect, useState } from 'react';

export function useSessionState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;

    try {
      const stored = window.sessionStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Session storage may be unavailable in restricted browsers.
    }
  }, [key, value]);

  const clear = () => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore storage failures.
      }
    }
    setValue(initialValue);
  };

  return [value, setValue, clear];
}
