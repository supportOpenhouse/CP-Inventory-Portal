/**
 * Guard against React error #310 — "Rendered more hooks than during the
 * previous render".
 *
 * A hook placed after an early `return` in a component runs on some renders and
 * not others, which crashes the whole view behind the error boundary rather
 * than failing locally. This repo has no eslint config, so react-hooks/rules-of
 * -hooks isn't catching it; this scan is the stand-in.
 *
 * It walks each component body by brace depth and flags any hook call that
 * appears after a top-level `return`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOOK = /\buse[A-Z]\w*\(/;
const COMPONENT = /^\s*(export default function|function|const)\s+([A-Z]\w*)/;

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsxFiles(p);
    return p.endsWith('.jsx') ? [p] : [];
  });
}

function findConditionalHooks(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const found = [];
  let i = 0;

  while (i < lines.length) {
    const m = COMPONENT.exec(lines[i]);
    if (!m) { i += 1; continue; }

    // Walk to the end of this component by brace depth.
    let depth = 0, bodyStart = null, j = i;
    while (j < lines.length) {
      depth += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
      if (bodyStart === null && lines[j].includes('{')) bodyStart = j;
      if (bodyStart !== null && depth <= 0) break;
      j += 1;
    }

    let d = 0, earlyReturn = null;
    for (let k = bodyStart ?? i; k <= Math.min(j, lines.length - 1); k += 1) {
      const line = lines[k];
      const s = line.trim();
      // depth 1 == directly in the component body, not nested in a callback.
      if (d === 1 && earlyReturn === null && /^(if \(.*\)\s*)?return\b/.test(s)) earlyReturn = k + 1;
      if (earlyReturn !== null && HOOK.test(line) && !s.startsWith('//') && !s.startsWith('*')) {
        found.push(`${file}:${k + 1} — hook after early return (line ${earlyReturn}) in <${m[2]}>`);
      }
      d += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    }
    i = j + 1;
  }
  return found;
}

test('no hook is called after an early return (React #310)', () => {
  const offenders = jsxFiles('src').flatMap(findConditionalHooks);
  assert.deepEqual(
    offenders, [],
    `Hooks must run on every render. Move these above the early return:\n${offenders.join('\n')}`,
  );
});
