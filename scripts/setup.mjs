/**
 * npm run setup — 클론 직후 한 번. OS 무관 동일한 한 줄.
 *
 * 하는 일:
 *   1. Node / Python 버전 확인
 *   2. Windows 재베이스 소음 방지용 git 설정 (저장소 로컬)
 *   3. .venv 생성 + requirements.txt 정확 버전 설치
 *   4. .env 없으면 .env.example 에서 생성
 *   5. npm run check 안내
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import {
  NODE_MIN,
  PYTHON_MAX,
  PYTHON_MIN,
  ROOT,
  c,
  capture,
  findSystemPython,
  heading,
  pythonEnv,
  run,
  venvExists,
  venvPython,
} from './lib.mjs';

let failed = false;
const die = (msg, hint) => {
  console.error(`${c.red('✗')} ${msg}`);
  if (hint) console.error(`  ${c.dim(hint)}`);
  failed = true;
};

/* ── 1. Node ─────────────────────────────────────────────── */
heading('1/5  Node');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < NODE_MIN) {
  die(
    `Node ${process.versions.node} — ${NODE_MIN} 이상이 필요합니다.`,
    'https://nodejs.org 에서 LTS 를 설치한 뒤 터미널을 새로 여세요.',
  );
  process.exit(1);
}
console.log(`${c.green('✓')} Node ${process.versions.node}`);

/* ── 2. git 설정 (저장소 로컬만 건드린다) ────────────────── */
heading('2/5  git 설정');
// 줄바꿈은 .gitattributes 가 결정한다. autocrlf 가 켜져 있으면 그것과 싸워서
// 리베이스할 때마다 파일 전체가 변경으로 잡힌다.
const gitSettings = [
  ['core.autocrlf', 'false'],
  ['core.eol', 'lf'],
  // 한글 파일명이 \357\232... 로 이스케이프되어 보이는 것 방지
  ['core.quotepath', 'false'],
  // Windows 260자 경로 제한 회피
  ['core.longpaths', 'true'],
  // 이 팀은 리베이스로 자주 푸시한다
  ['pull.rebase', 'true'],
];
if (existsSync(path.join(ROOT, '.git'))) {
  for (const [key, value] of gitSettings) {
    capture('git', ['config', '--local', key, value]);
  }
  console.log(`${c.green('✓')} ${gitSettings.map(([k]) => k).join(', ')}`);
} else {
  console.log(`${c.yellow('!')} .git 이 없어 건너뜁니다 (클론이 아닌 경우)`);
}

/* ── 3. Python venv ──────────────────────────────────────── */
heading('3/5  Python 가상환경');
const sys = findSystemPython();
if (!sys) {
  die(
    'Python 을 찾지 못했습니다.',
    'Windows: python.org 에서 설치하고 "Add python.exe to PATH" 를 체크하세요. ' +
      'Microsoft Store 버전은 쓰지 마세요.',
  );
  process.exit(1);
}

const [minLo, minHi] = PYTHON_MIN;
const [maxLo, maxHi] = PYTHON_MAX;
const tooOld = sys.major < minLo || (sys.major === minLo && sys.minor < minHi);
const tooNew = sys.major > maxLo || (sys.major === maxLo && sys.minor > maxHi);
if (tooOld || tooNew) {
  die(
    `Python ${sys.major}.${sys.minor} — 지원 범위는 ${minLo}.${minHi} ~ ${maxLo}.${maxHi} 입니다.`,
    'requirements.txt 가 정확한 버전으로 고정돼 있어 범위 밖에서는 설치가 실패할 수 있습니다.',
  );
  process.exit(1);
}
console.log(`${c.green('✓')} Python ${sys.major}.${sys.minor} (${sys.cmd})`);

if (!venvExists()) {
  console.log(`  ${c.dim('.venv 생성 중...')}`);
  const code = run(sys.cmd, [...sys.prefix, '-m', 'venv', '.venv']);
  if (code !== 0 || !venvExists()) {
    die('.venv 생성 실패');
    process.exit(1);
  }
}
console.log(`${c.green('✓')} .venv`);

console.log(`  ${c.dim('Python 패키지 설치 중 (1~2분)...')}`);
const pipEnv = pythonEnv();
run(venvPython(), ['-m', 'pip', 'install', '-q', '--upgrade', 'pip'], { env: pipEnv });
const pipCode = run(
  venvPython(),
  ['-m', 'pip', 'install', '-q', '--require-virtualenv', '-r', 'agent/requirements.txt'],
  { env: pipEnv },
);
if (pipCode !== 0) {
  die(
    'Python 패키지 설치 실패',
    `Python ${sys.major}.${sys.minor} 에서 고정 버전 휠을 못 찾았을 수 있습니다. ` +
      `지원 범위(${minLo}.${minHi}~${maxLo}.${maxHi}) 안의 버전을 쓰세요.`,
  );
} else {
  console.log(`${c.green('✓')} Python 패키지`);
}

/* ── 4. npm 패키지 ───────────────────────────────────────── */
heading('4/5  npm 패키지');
if (!existsSync(path.join(ROOT, 'node_modules'))) {
  console.log(`  ${c.dim('설치 중...')} ${c.dim('(npm install 을 직접 돌렸다면 건너뜁니다)')}`);
  console.log(`${c.yellow('!')} node_modules 가 없습니다. ${c.cyan('npm install')} 을 먼저 실행하세요.`);
} else {
  console.log(`${c.green('✓')} node_modules`);
}

/* ── 5. .env ─────────────────────────────────────────────── */
heading('5/5  비밀값');
const envPath = path.join(ROOT, '.env');
const examplePath = path.join(ROOT, '.env.example');
if (!existsSync(envPath) && existsSync(examplePath)) {
  copyFileSync(examplePath, envPath);
  console.log(`${c.green('✓')} .env 생성 (.env.example 복사)`);
} else {
  console.log(`${c.green('✓')} .env`);
}
console.log(
  `  ${c.dim('API 키는 A 담당자만 넣습니다. 나머지 세 명은 비워두고')} ${c.cyan('npm run agent:offline')} ${c.dim('을 씁니다.')}`,
);

mkdirSync(path.join(ROOT, 'agent', 'state'), { recursive: true });

/* ── 마무리 ──────────────────────────────────────────────── */
if (failed) {
  console.error(`\n${c.red('설치가 완료되지 않았습니다.')} 위 메시지를 확인하세요.`);
  process.exit(1);
}
console.log(`\n${c.green('설치 완료.')} 이제 ${c.cyan('npm run check')} 로 환경을 확인하세요.`);
