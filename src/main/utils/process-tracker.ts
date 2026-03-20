/**
 * Session Scribe — Child Process Tracker
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 *
 * Tracks spawned child processes so they can be killed on app shutdown
 * or when a recording is cancelled. Prevents orphaned ffmpeg/whisper-cli
 * processes from surviving after the parent Electron app exits.
 */

import { ChildProcess } from 'child_process';

class ProcessTracker {
  private processes = new Set<ChildProcess>();

  track(proc: ChildProcess): void {
    this.processes.add(proc);
    proc.on('exit', () => this.processes.delete(proc));
    proc.on('error', () => this.processes.delete(proc));
  }

  untrack(proc: ChildProcess): void {
    this.processes.delete(proc);
  }

  killAll(): void {
    for (const proc of this.processes) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }
    }
    this.processes.clear();
  }

  get count(): number {
    return this.processes.size;
  }
}

export const processTracker = new ProcessTracker();
