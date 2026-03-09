/**
 * Session Scribe — Disk Space Monitor
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import fs from 'fs';
import { EventEmitter } from 'events';

const WARN_THRESHOLD = 1024 * 1024 * 1024;  // 1 GB
const STOP_THRESHOLD = 512 * 1024 * 1024;   // 500 MB
const CHECK_INTERVAL = 60_000;               // 60 seconds

export class DiskMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private outputDir: string;

  constructor(outputDir: string) {
    super();
    this.outputDir = outputDir;
  }

  start(): void {
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    try {
      const freeBytes = this.getFreeSpace();
      if (freeBytes < STOP_THRESHOLD) {
        this.emit('critical', freeBytes);
      } else if (freeBytes < WARN_THRESHOLD) {
        this.emit('warning', freeBytes);
      }
    } catch {
      // Ignore errors in disk check
    }
  }

  private getFreeSpace(): number {
    const stats = fs.statfsSync(this.outputDir);
    return stats.bavail * stats.bsize;
  }
}
