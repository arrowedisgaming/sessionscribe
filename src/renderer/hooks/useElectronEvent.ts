/**
 * Session Scribe — useElectronEvent Hook
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import { useEffect } from 'react';

type UnsubscribeFn = () => void;
type SubscribeFn = (callback: (...args: unknown[]) => void) => UnsubscribeFn;

export function useElectronEvent(subscribe: SubscribeFn, handler: (...args: unknown[]) => void): void {
  useEffect(() => {
    const unsubscribe = subscribe(handler);
    return unsubscribe;
  }, [subscribe, handler]);
}
