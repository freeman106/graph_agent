/**
 * 계약 위반을 사람이 눈으로 보기 전에 잡아내는 빠른 검사.
 *
 * `npm run dev` / `npm run agent` 앞에 자동으로 붙는다(pre 스크립트).
 * 계약이 깨진 상태로는 아예 작업을 시작할 수 없게 만드는 것이 목적이다.
 *
 * Node 만 쓴다 — 파이썬 환경이 없는 프론트 담당자도 이 검사를 통과해야 하므로
 * venv 에 의존하면 안 된다. 200ms 안에 끝난다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { CONTRACT_FILES, ROOT, c, contractHashes, readContractLock } from './lib.mjs';

const problems = [];
const readText = (rel) =>
  readFileSync(path.join(ROOT, rel), 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/* ── 1. 계약 잠금 ────────────────────────────────────────── */
// 계약 변경 권한은 한 명에게만 있다. 잠금이 안 맞으면 누군가 몰래 고친 것이다.
const lock = readContractLock();
const now = contractHashes();
if (!lock) {
  problems.push('contract/.lock 이 없습니다. 계약 소유자가 `npm run contract:seal` 을 실행해야 합니다.');
} else {
  for (const rel of CONTRACT_FILES) {
    if (lock.hashes?.[rel] !== now[rel]) {
      problems.push(
        `${rel} 이(가) 잠금과 다릅니다.\n` +
          `      계약을 고칠 권한은 ${lock.owner ?? '계약 소유자'} 에게만 있습니다.\n` +
          `      실수로 고쳤다면: git checkout -- ${rel}\n` +
          `      의도한 변경이라면 소유자에게 알리고, 소유자가 npm run contract:seal 을 실행합니다.`,
      );
    }
  }
}

/* ── 2. schema.py ↔ schema.ts 필드 이름 대조 ─────────────── */
// 한쪽만 고치면 백엔드와 프론트가 조용히 어긋난다. 그걸 여기서 잡는다.
const py = readText('contract/schema.py');
const ts = readText('contract/schema.ts');

const pyModels = {};
for (const m of py.matchAll(/^class (\w+)\(BaseModel\):\n((?:(?!^class ).*\n)*)/gm)) {
  const [, name, body] = m;
  const fields = new Set();
  for (const f of body.matchAll(/^ {4}(\w+)\s*:/gm)) {
    if (!f[1].startsWith('_')) fields.add(f[1]);
  }
  pyModels[name] = fields;
}

const tsModels = {};
for (const m of ts.matchAll(/^export interface (\w+) \{\n((?:(?!^\}).*\n)*)/gm)) {
  const [, name, body] = m;
  const fields = new Set();
  for (const f of body.matchAll(/^ {2}(\w+)\??:/gm)) fields.add(f[1]);
  tsModels[name] = fields;
}

for (const [name, pyFields] of Object.entries(pyModels)) {
  const tsFields = tsModels[name];
  if (!tsFields) {
    problems.push(`schema.ts 에 interface ${name} 이(가) 없습니다. 두 파일은 항상 같이 고칩니다.`);
    continue;
  }
  const pyOnly = [...pyFields].filter((f) => !tsFields.has(f));
  const tsOnly = [...tsFields].filter((f) => !pyFields.has(f));
  if (pyOnly.length || tsOnly.length) {
    problems.push(
      `${name} 필드 불일치 — schema.py 에만: [${pyOnly}] / schema.ts 에만: [${tsOnly}]`,
    );
  }
}

/* ── 3. 계약 밖에서 타입을 다시 선언하지 않았는가 ────────── */
// 계약 타입과 같은 이름을 src/ 나 agent/ 에서 새로 선언하면 두 갈래가 생긴다.
const CONTRACT_TYPE_NAMES = Object.keys(pyModels).concat([
  'NodeStatus',
  'Relation',
  'StreamKind',
]);
const scanDirs = ['src', 'agent'];
const redeclared = [];

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'state' || entry.name === '__pycache__') continue;
      walk(rel);
      continue;
    }
    if (!/\.(ts|tsx|py)$/.test(entry.name)) continue;
    const text = readText(rel);
    for (const name of CONTRACT_TYPE_NAMES) {
      const declared = new RegExp(
        `^(export )?(interface|type|class) ${name}\\b|^class ${name}\\(BaseModel\\)`,
        'm',
      );
      if (declared.test(text)) redeclared.push(`${rel} → ${name}`);
    }
  }
}
scanDirs.forEach(walk);
if (redeclared.length) {
  problems.push(
    `계약 타입을 다시 선언했습니다. contract/ 에서 import 하세요:\n      ` +
      redeclared.join('\n      '),
  );
}

/* ── 4. 픽스처가 계약을 만족하는가 (구조만, 파이썬 없이) ── */
const fixtureDir = path.join(ROOT, 'contract', 'fixtures');
if (existsSync(fixtureDir)) {
  for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) {
    const rel = `contract/fixtures/${file}`;
    let data;
    try {
      data = JSON.parse(readText(rel));
    } catch (err) {
      problems.push(`${rel} JSON 파싱 실패: ${err.message}`);
      continue;
    }
    if (Array.isArray(data?.nodes) && Array.isArray(data?.edges)) {
      const ids = new Set(data.nodes.map((n) => n.id));
      const dangling = data.edges.filter((e) => !ids.has(e.from_id) || !ids.has(e.to_id));
      if (dangling.length) {
        problems.push(`${rel} 에 끊어진 간선 ${dangling.length}개: ${dangling.map((e) => e.id)}`);
      }
    }
  }
}

/* ── 결과 ────────────────────────────────────────────────── */
if (problems.length === 0) {
  if (process.argv.includes('--quiet')) process.exit(0);
  console.log(`${c.green('✓')} 계약 검사 통과`);
  process.exit(0);
}

console.error(`\n${c.red('계약 위반')} — 작업을 시작할 수 없습니다.\n`);
for (const p of problems) console.error(`  ${c.red('✗')} ${p}`);
console.error(`\n  ${c.dim('규칙은 AGENTS.md 를 보세요.')}\n`);
process.exit(1);
