import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const rootDir = fileURLToPath(new URL('./src/admin', import.meta.url));
const distDir = fileURLToPath(new URL('./dist', import.meta.url));

/**
 * `version.json`, beside `index.html`, saying which build this is and which server it needs.
 *
 * The server had no way to read this bundle's version at all — it knew the player's, because
 * the player emits one of these, and inferred nothing about the console it was serving. That
 * gap is why a console could be installed onto a core that cannot answer it: there was
 * nothing to check.
 *
 * `minCore` comes from `sonn.minCore` in package.json and is the oldest server core that can
 * serve this bundle. The server refuses an update whose minimum it is below, *before*
 * swapping anything in — so the value has to travel with the artefact rather than live in a
 * table somewhere. Emitting through `emitFile` is what makes that true everywhere: the
 * release tarball, a local `npm run build` and the server's `fetch:admin` copy all carry it
 * without any of them knowing about it.
 *
 * Always name the beta the requirement actually landed in, never the stable it is heading
 * for — `4.0.0-beta.30` does not satisfy a minimum of `4.0.0`, so writing the round number
 * locks out every beta install.
 */
function versionManifest(pkg: { version?: string; sonn?: { minCore?: string } }): Plugin {
  return {
    name: 'sonn-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(
          { version: pkg.version ?? '0.0.0', minCore: pkg.sonn?.minCore ?? null },
          null,
          2,
        )}\n`,
      });
    },
  };
}

export default defineConfig(() => {
  const target = process.env.AUDIOSERVER_URL ?? 'http://localhost:7090';
  const pkg = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
  ) as { version?: string; sonn?: { minCore?: string } };

  return {
    root: rootDir,
    base: '/admin/',
    publicDir: 'public',
    plugins: [react(), versionManifest(pkg)],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
      // So the running bundle can tell the user itself when it outgrew its server — the
      // update gate cannot help once a bundle is already installed.
      __MIN_CORE__: JSON.stringify(pkg.sonn?.minCore ?? null),
    },
    build: {
      outDir: distDir,
      emptyOutDir: true,
      target: 'es2018',
      rollupOptions: {
        output: {
          // Split the framework/i18n vendors into their own chunks so the app
          // chunk stays under the size-warning threshold (and caches better).
          manualChunks: {
            react: ['react', 'react-dom'],
            i18n: ['i18next', 'react-i18next'],
          },
        },
      },
    },
    server: {
      host: true,
      proxy: {
        '/admin/api': {
          target,
          changeOrigin: true,
          ws: true,
        },
        '/api': {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
