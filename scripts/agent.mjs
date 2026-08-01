/**
 * npm run agent [-- 인자...]  /  npm run agent:offline
 *
 * 파이썬을 직접 부르지 않는 이유:
 *   - 실행 파일 위치가 OS 마다 다르다 (.venv/Scripts vs .venv/bin)
 *   - 한국어 Windows 는 기본 인코딩이 cp949 라 UTF-8 강제가 필요하다
 *   - .env 의 API 키를 자식 프로세스에 넘겨야 한다
 * 이 세 가지를 여기서 처리하고, 밖에서는 한 줄만 보이게 한다.
 */

import { c, pythonEnv, run, venvExists, venvPython } from './lib.mjs';

// 계약이 깨진 상태로는 에이전트를 돌리지 않는다.
// npm 의 pre 스크립트는 agent / agent:offline / agent:reset 마다 따로 걸어야 해서
// 빠뜨리기 쉽다. 여기서 한 번만 막는 편이 확실하다.
if (run(process.execPath, ['scripts/contract-check.mjs', '--quiet']) !== 0) {
  process.exit(1);
}

if (!venvExists()) {
  console.error(`${c.red('✗')} .venv 가 없습니다. 먼저 ${c.cyan('npm run setup')} 을 실행하세요.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const env = pythonEnv();

if (!offline && !env.OPENAI_API_KEY) {
  console.error(`${c.red('✗')} OPENAI_API_KEY 가 없습니다.`);
  console.error(`  ${c.dim('키는 A 담당자만 가집니다. 키 없이 개발하려면:')}`);
  console.error(`      ${c.cyan('npm run agent:offline')}`);
  console.error(`  ${c.dim('키를 가진 사람은 .env 에 OPENAI_API_KEY=sk-... 를 넣으세요.')}`);
  process.exit(1);
}

if (!offline) {
  // 키 자체는 절대 찍지 않는다. 있다는 사실만 알린다.
  const key = env.OPENAI_API_KEY ?? '';
  console.log(`${c.dim(`OPENAI_API_KEY 사용 중 (…${key.slice(-4)})`)}`);
}

process.exit(run(venvPython(), ['-X', 'utf8', '-m', 'agent.main', ...args], { env }));
