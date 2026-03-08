/**
 * Session Scribe — useConfig Hook
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import { useState, useEffect, useCallback } from 'react';

export function useConfig<T>(key: string): [T | undefined, (value: T) => Promise<void>] {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    window.electronAPI.configGet(key).then((v: unknown) => setValue(v as T));
  }, [key]);

  const update = useCallback(async (newValue: T) => {
    await window.electronAPI.configSet(key, newValue);
    setValue(newValue);
  }, [key]);

  return [value, update];
}
