/**
 * Session Scribe — Process Tracker Tests
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import { EventEmitter } from 'events';

// Import fresh instance per test — the module exports a singleton,
// so we re-require it in each test via isolateModules.
function createTracker() {
  let tracker: typeof import('../main/utils/process-tracker')['processTracker'];
  jest.isolateModules(() => {
    tracker = require('../main/utils/process-tracker').processTracker;
  });
  return tracker!;
}

const mockProc = () => {
  const p = new EventEmitter() as any;
  p.kill = jest.fn();
  return p;
};

describe('ProcessTracker', () => {
  describe('track()', () => {
    it('adds a process and increments count', () => {
      const tracker = createTracker();
      const proc = mockProc();

      expect(tracker.count).toBe(0);
      tracker.track(proc);
      expect(tracker.count).toBe(1);
    });

    it('tracks multiple processes simultaneously', () => {
      const tracker = createTracker();
      const p1 = mockProc();
      const p2 = mockProc();
      const p3 = mockProc();

      tracker.track(p1);
      tracker.track(p2);
      tracker.track(p3);

      expect(tracker.count).toBe(3);
    });
  });

  describe('auto-removal on events', () => {
    it('removes process from set when it emits "exit"', () => {
      const tracker = createTracker();
      const proc = mockProc();

      tracker.track(proc);
      expect(tracker.count).toBe(1);

      proc.emit('exit', 0, null);
      expect(tracker.count).toBe(0);
    });

    it('removes process from set when it emits "error"', () => {
      const tracker = createTracker();
      const proc = mockProc();

      tracker.track(proc);
      expect(tracker.count).toBe(1);

      proc.emit('error', new Error('spawn ENOENT'));
      expect(tracker.count).toBe(0);
    });

    it('only removes the process that exited, not others', () => {
      const tracker = createTracker();
      const p1 = mockProc();
      const p2 = mockProc();

      tracker.track(p1);
      tracker.track(p2);
      expect(tracker.count).toBe(2);

      p1.emit('exit', 0, null);
      expect(tracker.count).toBe(1);

      // p2 should still be tracked
      p2.emit('exit', 0, null);
      expect(tracker.count).toBe(0);
    });
  });

  describe('untrack()', () => {
    it('manually removes a process from tracking', () => {
      const tracker = createTracker();
      const proc = mockProc();

      tracker.track(proc);
      expect(tracker.count).toBe(1);

      tracker.untrack(proc);
      expect(tracker.count).toBe(0);
    });

    it('is a no-op for a process that is not tracked', () => {
      const tracker = createTracker();
      const proc = mockProc();

      expect(() => tracker.untrack(proc)).not.toThrow();
      expect(tracker.count).toBe(0);
    });
  });

  describe('killAll()', () => {
    it('sends SIGTERM to all tracked processes', () => {
      const tracker = createTracker();
      const p1 = mockProc();
      const p2 = mockProc();

      tracker.track(p1);
      tracker.track(p2);

      tracker.killAll();

      expect(p1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(p2.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('clears the set after killing', () => {
      const tracker = createTracker();
      const proc = mockProc();

      tracker.track(proc);
      tracker.killAll();

      expect(tracker.count).toBe(0);
    });

    it('handles already-exited processes gracefully (no throw)', () => {
      const tracker = createTracker();
      const proc = mockProc();
      proc.kill.mockImplementation(() => {
        throw new Error('kill ESRCH');
      });

      tracker.track(proc);

      expect(() => tracker.killAll()).not.toThrow();
      expect(tracker.count).toBe(0);
    });

    it('kills remaining processes even if one throws', () => {
      const tracker = createTracker();
      const p1 = mockProc();
      const p2 = mockProc();

      p1.kill.mockImplementation(() => {
        throw new Error('kill ESRCH');
      });

      tracker.track(p1);
      tracker.track(p2);

      tracker.killAll();

      expect(p1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(p2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(tracker.count).toBe(0);
    });

    it('is a no-op when no processes are tracked', () => {
      const tracker = createTracker();
      expect(() => tracker.killAll()).not.toThrow();
      expect(tracker.count).toBe(0);
    });
  });

  describe('count', () => {
    it('returns 0 initially', () => {
      const tracker = createTracker();
      expect(tracker.count).toBe(0);
    });

    it('reflects the current number of tracked processes accurately', () => {
      const tracker = createTracker();
      const p1 = mockProc();
      const p2 = mockProc();

      tracker.track(p1);
      expect(tracker.count).toBe(1);

      tracker.track(p2);
      expect(tracker.count).toBe(2);

      p1.emit('exit', 0, null);
      expect(tracker.count).toBe(1);

      tracker.untrack(p2);
      expect(tracker.count).toBe(0);
    });
  });
});
