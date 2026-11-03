import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { loadEnv } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  imports: false,
  manifest: {
    name: 'Polyglot Player for Netflix',
    description:
      'Learn languages with Netflix: dual subtitles, transcript sidebar, click-to-translate, saved words and Anki export.',
    // nativeMessaging: the Claude Code helper for key lines (native-host/, npm run claude:install).
    // offscreen: the page that reads summaries aloud with Kokoro (entrypoints/offscreen).
    // system.display: the monitors, to put the floating sidebar window on the one without Netflix (src/services/floatwin.ts).
    // alarms: the ⭐ due count on the toolbar icon and backup files after changes (src/services/backup.ts).
    permissions: ['storage', 'unlimitedStorage', 'tts', 'nativeMessaging', 'offscreen', 'system.display', 'alarms'],
    host_permissions: [
      'https://www.netflix.com/*',
      '*://*.nflxvideo.net/*',
      'https://translate.googleapis.com/*',
      'https://api.openai.com/*',
    ],
    optional_host_permissions: [
      'https://api.anthropic.com/*',
      'http://127.0.0.1:8765/*',
      'http://localhost:8765/*',
    ],
    action: { default_title: 'Polyglot Player' },
    // wasm-unsafe-eval: Kokoro runs on ONNX Runtime's WebAssembly in the offscreen page.
    // Cross-origin isolation lets Kokoro run on several CPU threads (SharedArrayBuffer); single-threaded it is slower
    // than real time. credentialless still loads cross-origin resources, without cookies.
    cross_origin_embedder_policy: { value: 'credentialless' },
    cross_origin_opener_policy: { value: 'same-origin' },
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
  },
  hooks: {
    // Kokoro's ONNX runtime loads its WebAssembly and loader at run time (src/services/kokoro.ts sets the path).
    'build:publicAssets': (_wxt, files) => {
      for (const ext of ['wasm', 'mjs']) {
        const name = `ort-wasm-simd-threaded.jsep.${ext}`;
        files.push({ absoluteSrc: resolve(`node_modules/onnxruntime-web/dist/${name}`), relativeDest: `ort/${name}` });
      }
    },
  },
  vite: (env) => {
    // OPENAI_API_KEY / LLM_MODEL from .env. Only src/services/openai.ts (background) references them,
    // but the key does end up in the build output: don't share .output/ or zips built with a key.
    const dotenv = loadEnv(env.mode, '.', '');
    return {
      plugins: [preact()],
      define: {
        __OPENAI_API_KEY__: JSON.stringify(dotenv.OPENAI_API_KEY ?? ''),
        __LLM_MODEL__: JSON.stringify(dotenv.LLM_MODEL || 'gpt-4o-mini'),
      },
    };
  },
});
