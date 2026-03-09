import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PublisherGithub } from '@electron-forge/publisher-github';

import * as path from 'path';
import * as fs from 'fs-extra';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

// Packages that webpack externalizes — these need to be copied into the
// packaged app's node_modules/ so bare require() calls can resolve them.
const EXTERNAL_PACKAGES = [
  '@discordjs/voice',
  'opusscript',
  '@discordjs/opus',      // optional native — skipped if not installed
  'sodium-native',        // optional native — skipped if not installed
  'onnxruntime-node',     // optional native — skipped if not installed
  '@noble/ciphers',       // encryption fallback loaded by voice via dynamic import
  '@snazzah/davey',       // DAVE protocol loaded by voice via dynamic import
  'discord.js',           // voice depends on discord.js internals
  'prism-media',          // voice uses prism-media for audio processing
];

/**
 * Recursively copy a package and its production dependencies from the
 * project's node_modules into the build's node_modules.
 */
async function copyPackageWithDeps(
  packageName: string,
  projectModules: string,
  buildModules: string,
  copied: Set<string>,
): Promise<void> {
  if (copied.has(packageName)) return;
  copied.add(packageName);

  const src = path.join(projectModules, packageName);
  const dest = path.join(buildModules, packageName);

  if (!await fs.pathExists(src)) {
    console.log(`  [skip] ${packageName} — not installed`);
    return;
  }

  // For scoped packages, ensure the @scope/ directory exists
  if (packageName.startsWith('@')) {
    await fs.ensureDir(path.join(buildModules, packageName.split('/')[0]));
  }

  await fs.copy(src, dest, { overwrite: true });
  console.log(`  [copy] ${packageName}`);

  // Read its production dependencies and copy those too
  const pkgJsonPath = path.join(src, 'package.json');
  if (await fs.pathExists(pkgJsonPath)) {
    const pkgJson = await fs.readJson(pkgJsonPath);
    const deps = Object.keys(pkgJson.dependencies || {});
    for (const dep of deps) {
      await copyPackageWithDeps(dep, projectModules, buildModules, copied);
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Session Scribe',
    executableName: 'session-scribe',
  },
  rebuildConfig: {
    onlyModules: [],
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      console.log('\n[packageAfterCopy] Copying externalized modules into build…');

      const projectRoot = __dirname;
      const projectModules = path.join(projectRoot, 'node_modules');
      const buildModules = path.join(buildPath, 'node_modules');

      await fs.ensureDir(buildModules);

      const copied = new Set<string>();
      for (const pkg of EXTERNAL_PACKAGES) {
        await copyPackageWithDeps(pkg, projectModules, buildModules, copied);
      }

      console.log(`[packageAfterCopy] Done — copied ${copied.size} packages.\n`);
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}),
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerRpm({
      options: {
        homepage: 'https://github.com/arrowedisgaming/sessionscribe',
        categories: ['AudioVideo', 'Audio', 'Utility'],
      },
    }),
    new MakerDeb({
      options: {
        maintainer: 'Arrowed',
        homepage: 'https://github.com/arrowedisgaming/sessionscribe',
        categories: ['AudioVideo', 'Audio', 'Utility'],
      },
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'arrowedisgaming',
        name: 'sessionscribe',
      },
      draft: true,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/renderer.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
