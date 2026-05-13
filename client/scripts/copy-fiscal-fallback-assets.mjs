import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(currentDir, '..');
const repoRoot = resolve(clientRoot, '..');
const sourceDir = resolve(repoRoot, 'database', 'r2');
const targetDir = resolve(clientRoot, 'dist', 'fiscal-bases');
const requireFallbackAssets = process.env.REQUIRE_FISCAL_FALLBACK_ASSETS === 'true';

const assets = [
  'fiscal_offline.meta.json',
  'fiscal_offline.enc',
];

function assertReadableFile(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size <= 0) {
    throw new Error(`Missing fiscal fallback asset: ${path}`);
  }
}

mkdirSync(targetDir, { recursive: true });

const missingAssets = assets.filter((asset) => {
  const sourcePath = resolve(sourceDir, asset);
  return !existsSync(sourcePath) || !statSync(sourcePath).isFile() || statSync(sourcePath).size <= 0;
});

if (missingAssets.length > 0 && !requireFallbackAssets) {
  console.warn(
    `[copy-fiscal-fallback-assets] Skipping bundled fiscal fallback copy; missing ${missingAssets.join(', ')} in ${sourceDir}.`
  );
  process.exit(0);
}

for (const asset of assets) {
  const sourcePath = resolve(sourceDir, asset);
  const targetPath = resolve(targetDir, asset);
  assertReadableFile(sourcePath);
  copyFileSync(sourcePath, targetPath);
  assertReadableFile(targetPath);
}
