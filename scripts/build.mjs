/**
 * npm run build — 셸 연산자 없이 두 단계를 순서대로 실행한다.
 *
 * `tsc -b && vite build` 는 npm 이 cmd.exe 로 스크립트를 돌릴 때만 동작한다.
 * script-shell 이 PowerShell 5.1 로 설정된 환경에서는 `&&` 가 문법 오류다.
 * 실행 경로에서 셸 연산자를 아예 없앤다.
 */

import { c, run } from './lib.mjs';

const tsc = run(process.execPath, ['node_modules/typescript/bin/tsc', '-b']);
if (tsc !== 0) {
  console.error(c.red('타입 검사 실패 — 빌드를 중단합니다.'));
  process.exit(tsc);
}
process.exit(run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']));
