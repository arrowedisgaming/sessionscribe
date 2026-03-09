/**
 * Session Scribe — Binary Resolver
 * Copyright (C) 2026 Arrowed
 * License: GPL-3.0-or-later
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export function resolveBinaryPath(binaryName: string): string {
  const execName = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  const platformDir = `${process.platform}-${process.arch}`;

  // 1. User-data bin dir (downloaded by BinaryManager at runtime)
  const userDataPath = path.join(app.getPath('userData'), 'bin', execName);
  if (fs.existsSync(userDataPath)) return userDataPath;

  // 2. Production: bundled in resources
  const prodPath = path.join(process.resourcesPath, 'bin', platformDir, execName);
  if (fs.existsSync(prodPath)) return prodPath;

  // 3. Development: project resources/bin/
  const devPath = path.join(app.getAppPath(), 'resources', 'bin', platformDir, execName);
  if (fs.existsSync(devPath)) return devPath;

  throw new Error(
    `Binary "${binaryName}" not found. Please download it via Settings > Binaries.`
  );
}
