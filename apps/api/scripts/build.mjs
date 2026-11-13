// Empacota API e worker com esbuild. Dependências npm ficam externas (instaladas no runtime);
// o pacote compartilhado @lle/shared (TypeScript do monorepo) é embutido.
import { build } from 'esbuild';
import { readFile, cp, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@lle/'));

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: { main: 'src/main.ts', 'worker-main': 'src/worker-main.ts', migrate: 'src/db/migrate-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
await cp(new URL('../migrations', import.meta.url), new URL('../dist/migrations', import.meta.url), { recursive: true });
