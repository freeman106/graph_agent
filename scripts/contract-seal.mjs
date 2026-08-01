/**
 * npm run contract:seal — 계약 소유자 전용.
 *
 * 계약 타입을 의도적으로 바꾼 뒤, 그 변경을 공식화한다.
 * 소유자가 아니면 실행하지 않는다. AGENTS.md 의 소유자 표를 보라.
 */

import { writeFileSync } from 'node:fs';

import { CONTRACT_LOCK, c, contractHashes, readContractLock } from './lib.mjs';

const owner = process.env.CONTRACT_OWNER ?? readContractLock()?.owner ?? 'A (에이전트 코어 담당)';
const hashes = contractHashes();

const missing = Object.entries(hashes).filter(([, h]) => h === 'MISSING');
if (missing.length) {
  console.error(`${c.red('✗')} 계약 파일이 없습니다: ${missing.map(([f]) => f).join(', ')}`);
  process.exit(1);
}

writeFileSync(
  CONTRACT_LOCK,
  `${JSON.stringify({ owner, hashes }, null, 2)}\n`,
  'utf-8',
);

console.log(`${c.green('✓')} 계약을 봉인했습니다.`);
for (const [file, hash] of Object.entries(hashes)) {
  console.log(`  ${c.dim(hash)}  ${file}`);
}
console.log(`\n  소유자: ${owner}`);
console.log(`  ${c.yellow('이 변경을 팀에 알리세요.')} 다른 세 명은 pull 받기 전까지 계약 검사가 실패합니다.`);
