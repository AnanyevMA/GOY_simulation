// Общие утилиты тестов: «свежий» экземпляр модели (изолированное состояние), прогон тиков, детерминированный ГСЧ.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let seq = 0;

/** Импортирует model.js заново (query-строка даёт новый экземпляр модуля → чистый state). */
export async function freshModel() {
    return import(`${join(ROOT, 'src/model.js')}?i=${seq++}&t=${Date.now()}`);
}
export function run(m, ticks) { for (let i = 0; i < ticks; i++) m.tick(); }
export function readText(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

/** mulberry32 — маленький детерминированный ГСЧ, чтобы фаззинг был воспроизводимым. */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
