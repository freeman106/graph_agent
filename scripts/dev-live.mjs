/**
 * npm run dev:live
 *
 * 프론트를 띄우되, 그래프를 시드 대신 **에이전트가 실제로 만든 것**으로 보여준다.
 * 목 데이터로 화면을 채우는 대신 `npm run agent` 의 결과가 그대로 그려진다.
 *
 * 환경변수를 명령줄 앞에 붙이는 방식(`KG_LIVE=1 vite`)은 Windows 에서 안 돌기
 * 때문에 여기서 흡수한다. AGENTS.md 0절.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { c, ROOT, run, stateFile } from './lib.mjs';

// 계약이 깨진 상태로는 띄우지 않는다. npm 의 predev 는 dev 에만 걸려 있다.
if (run(process.execPath, ['scripts/contract-check.mjs', '--quiet']) !== 0) {
  process.exit(1);
}

const live = stateFile('graph.json');

if (existsSync(live)) {
  console.log(`${c.dim('실제 실행 그래프를 사용합니다')} ${c.cyan(live)}`);
} else {
  console.log(`${c.red('✗')} 실제 실행 결과가 없습니다.`);
  console.log(`  ${c.dim('먼저 에이전트를 한 번 돌리세요:')}`);
  console.log(`      ${c.cyan('npm run agent')}          ${c.dim('(API 키 필요)')}`);
  console.log(`      ${c.cyan('npm run agent:offline')}  ${c.dim('(키 없이)')}`);
  console.log(`  ${c.dim('시드 그래프로 보려면')} ${c.cyan('npm run dev')} ${c.dim('를 쓰세요.')}`);
  process.exit(1);
}

// vite 를 node 로 직접 부른다. .bin 의 실행 파일은 OS 마다 확장자가 달라
// shell 을 태워야 하는데, 그러면 Windows 에서 인자 처리가 갈린다.
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

process.exit(run(process.execPath, [vite], { env: { ...process.env, KG_LIVE: '1' } }));
