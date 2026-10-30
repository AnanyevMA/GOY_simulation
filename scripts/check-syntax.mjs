// Проверка синтаксиса всех ES-модулей из src/ (замена `node -c`, который не понимает ESM в старых Node).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src');
let failed = 0;
for (const f of readdirSync(dir).filter(n => n.endsWith('.js')).sort()) {
    const r = spawnSync(process.execPath, ['--check', join(dir, f)], { encoding: 'utf8' });
    if (r.status === 0) console.log(`✓ src/${f}`);
    else { failed++; console.error(`✗ src/${f}\n${r.stderr}`); }
}
if (failed) { console.error(`\n${failed} файл(ов) с синтаксическими ошибками`); process.exit(1); }
