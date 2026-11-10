import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/postcss';

// Isolated browser fixture: renders the production editor, never writes to Core.
export default defineConfig({
  root: fileURLToPath(new URL('./metre-workspace-fixture', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: '127.0.0.1', port: 4179, strictPort: true },
});
