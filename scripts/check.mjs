/**
 * npm run check — "제 환경에서는 되는데요" 를 막는 진단.
 *
 * 클론한 사람이 이 한 줄로 자기 환경이 정상인지 확인한다.
 * 실패하면 무엇이 왜 틀렸는지와 다음 행동을 같이 알려준다.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  IS_WINDOWS,
  NODE_MIN,
  PYTHON_MAX,
  PYTHON_MIN,
  ROOT,
  c,
  capture,
  loadDotEnv,
  pythonEnv,
  findSystemPython,
  venvExists,
  venvPython,
} from './lib.mjs';

const results = [];
const ok = (name, detail = '') => results.push({ level: 'ok', name, detail });
const warn = (name, detail = '') => results.push({ level: 'warn', name, detail });
const bad = (name, detail = '', fix = '') => results.push({ level: 'bad', name, detail, fix });

/* ── Windows 전용 함정 ───────────────────────────────────── */
if (IS_WINDOWS) {
  // 콘솔 코드페이지. 949(한국어 기본)면 파이썬이 UTF-8 로 내보낸 한국어가
  // 화면에서 깨져 보인다. 데이터는 멀쩡하지만 디버깅할 때 사람을 헷갈리게 한다.
  const chcp = capture('cmd', ['/c', 'chcp']);
  const page = (chcp.stdout.match(/(\d{3,5})\s*$/m) ?? [])[1];
  if (page && page !== '65001') {
    warn(
      '콘솔 코드페이지',
      `${page} — 한국어가 깨져 보일 수 있습니다. Windows Terminal 을 쓰거나 chcp 65001 을 먼저 실행하세요`,
    );
  } else {
    ok('콘솔 코드페이지', page ?? 'unknown');
  }
}

// 경로에 한글이나 공백이 있으면 파이썬 venv / pip 가 드물게 실패한다.
// macOS 에서는 재현되지 않으므로 여기서 미리 알린다.
if (/[^\x20-\x7e]/.test(ROOT)) {
  warn(
    '저장소 경로',
    `비ASCII 문자 포함 — ${ROOT}. 문제가 생기면 영문 경로(예: C:\\dev\\graph_agent)로 다시 클론하세요`,
  );
} else {
  ok('저장소 경로', ROOT);
}

/* ── Node ────────────────────────────────────────────────── */
const nodeMajor = Number(process.versions.node.split('.')[0]);
nodeMajor >= NODE_MIN
  ? ok('Node', process.versions.node)
  : bad('Node', `${process.versions.node} < ${NODE_MIN}`, 'nodejs.org 에서 LTS 설치 후 터미널 재시작');

existsSync(path.join(ROOT, 'node_modules'))
  ? ok('node_modules')
  : bad('node_modules', '없음', 'npm install');

/* ── Python ──────────────────────────────────────────────── */
if (!venvExists()) {
  bad('.venv', '없음', 'npm run setup');
  // 왜 못 만들었는지 바로 보이게 시스템 파이썬 탐색 결과를 같이 찍는다.
  const { chosen, attempts } = findSystemPython();
  for (const a of attempts) {
    results.push({
      level: chosen && a.result.startsWith('Python') ? 'ok' : 'warn',
      name: `  python 탐색: ${a.label}`,
      detail: a.result,
    });
  }
  if (!chosen) {
    results.push({
      level: 'bad',
      name: '  → 결론',
      detail: 'ENOENT 만 보이면 PATH 문제입니다. 터미널을 새로 열거나 Python 을 PATH 포함으로 재설치하세요.',
    });
  }
} else {
  ok('.venv', venvPython().replace(ROOT + path.sep, ''));

  const env = pythonEnv();
  const ver = capture(venvPython(), ['-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], { env });
  const [maj, min] = (ver.stdout.trim() || '0.0').split('.').map(Number);
  const inRange =
    (maj > PYTHON_MIN[0] || (maj === PYTHON_MIN[0] && min >= PYTHON_MIN[1])) &&
    (maj < PYTHON_MAX[0] || (maj === PYTHON_MAX[0] && min <= PYTHON_MAX[1]));
  inRange
    ? ok('Python', `${maj}.${min}`)
    : bad(
        'Python',
        `${maj}.${min} — 지원 범위 ${PYTHON_MIN.join('.')} ~ ${PYTHON_MAX.join('.')}`,
        '지원 범위 안의 Python 설치 후 .venv 폴더를 지우고 npm run setup',
      );

  /* 고정 버전이 실제로 맞는가 — 사람마다 버전이 달라질 여지를 없앤다 */
  const reqPath = path.join(ROOT, 'agent', 'requirements.txt');
  const required = new Map();
  for (const line of readFileSync(reqPath, 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [name, version] = t.split('==');
    if (version) required.set(name.trim().toLowerCase().replace(/[-_.]+/g, '-'), version.trim());
  }
  const freeze = capture(venvPython(), ['-m', 'pip', 'freeze'], { env });
  const installed = new Map();
  for (const line of freeze.stdout.split(/\r?\n/)) {
    const [name, version] = line.trim().split('==');
    if (version) installed.set(name.trim().toLowerCase().replace(/[-_.]+/g, '-'), version.trim());
  }
  const mismatched = [];
  for (const [name, version] of required) {
    const got = installed.get(name);
    if (got !== version) mismatched.push(`${name} ${got ?? '없음'} ≠ ${version}`);
  }
  mismatched.length === 0
    ? ok('Python 패키지', `${required.size}개 고정 버전 일치`)
    : bad(
        'Python 패키지',
        mismatched.slice(0, 4).join(', ') + (mismatched.length > 4 ? ` 외 ${mismatched.length - 4}건` : ''),
        'npm run setup',
      );

  /* 한국어 왕복 — 이 검사가 Windows 인코딩 사고를 잡는다 */
  const probe = capture(
    venvPython(),
    [
      '-c',
      'import json,sys,tempfile,os;'
      + 's="약점 정정 전→후 · 한국어 🇰🇷";'
      + 'p=os.path.join(tempfile.gettempdir(),"kg_enc_probe.json");'
      + 'open(p,"w",encoding="utf-8").write(json.dumps({"t":s},ensure_ascii=False));'
      + 'r=json.load(open(p,encoding="utf-8-sig"))["t"];os.remove(p);'
      + 'print("OK" if r==s else "MISMATCH");print(s)',
    ],
    { env },
  );
  probe.stdout.includes('OK') && probe.stdout.includes('약점')
    ? ok('한국어 인코딩 왕복', 'UTF-8 강제 적용됨')
    : bad(
        '한국어 인코딩 왕복',
        (probe.stderr || probe.stdout).trim().split('\n')[0] || '실패',
        '항상 npm run agent 로 실행하세요. 파이썬을 직접 부르면 UTF-8 강제가 빠집니다.',
      );

  /* 픽스처가 계약 모델로 검증되는가 */
  const fixture = capture(
    venvPython(),
    [
      '-c',
      'import pathlib;from contract.schema import Graph,Conversation,ReferenceBook;import json;'
      + 'g=Graph.model_validate_json(pathlib.Path("contract/fixtures/seed_graph.json").read_text(encoding="utf-8-sig"));'
      + 'c=Conversation.model_validate_json(pathlib.Path("contract/fixtures/kv_cache_conversation.json").read_text(encoding="utf-8-sig"));'
      + 'r=ReferenceBook.model_validate(json.loads(pathlib.Path("contract/fixtures/reference.json").read_text(encoding="utf-8-sig")));'
      + 'print(f"{len(g.nodes)} nodes / {len(g.edges)} edges / {len(c.turns)} turns / {len(r.entries)} refs")',
    ],
    { env },
  );
  fixture.status === 0
    ? ok('픽스처 ↔ 계약 모델', fixture.stdout.trim())
    : bad('픽스처 ↔ 계약 모델', fixture.stderr.trim().split('\n').pop() ?? '', '계약 소유자에게 알리세요');
}

/* ── 계약 ────────────────────────────────────────────────── */
const contract = capture(process.execPath, ['scripts/contract-check.mjs']);
contract.status === 0
  ? ok('계약 검사')
  : bad('계약 검사', contract.stdout.trim() + contract.stderr.trim(), 'AGENTS.md 의 계약 규칙 참고');

/* ── 타입 ────────────────────────────────────────────────── */
const tsc = capture(process.execPath, ['node_modules/typescript/bin/tsc', '-b', '--force']);
tsc.status === 0
  ? ok('TypeScript 타입 검사')
  : bad('TypeScript 타입 검사', (tsc.stdout || tsc.stderr).trim().split('\n').slice(0, 3).join(' / '));

/* ── 줄바꿈 / git 설정 ───────────────────────────────────── */
existsSync(path.join(ROOT, '.gitattributes'))
  ? ok('.gitattributes', '줄바꿈 LF 로 통일')
  : bad('.gitattributes', '없음', '저장소에서 사라졌습니다. 계약 소유자에게 알리세요');

if (existsSync(path.join(ROOT, '.git'))) {
  const autocrlf = capture('git', ['config', '--get', 'core.autocrlf']).stdout.trim();
  autocrlf === 'true'
    ? bad('git core.autocrlf', 'true — 리베이스마다 파일 전체가 변경으로 잡힙니다', 'npm run setup')
    : ok('git core.autocrlf', autocrlf || 'unset');
}

/* ── 비밀값 ──────────────────────────────────────────────── */
const dotenv = loadDotEnv();
if (dotenv.OPENAI_API_KEY) {
  ok('OPENAI_API_KEY', `설정됨 (…${dotenv.OPENAI_API_KEY.slice(-4)})`);
} else {
  warn('OPENAI_API_KEY', '없음 — npm run agent:offline 로 개발하세요 (정상입니다)');
}

const tracked = capture('git', ['ls-files', '--error-unmatch', '.env']);
tracked.status === 0
  ? bad('.env 추적 상태', '저장소에 커밋되어 있습니다', 'git rm --cached .env 후 키를 즉시 폐기하세요')
  : ok('.env 추적 상태', '추적 안 됨');

/* ── 오프라인 스모크 ─────────────────────────────────────── */
if (venvExists()) {
  const smoke = capture(venvPython(), ['-X', 'utf8', '-m', 'agent.main', '--offline'], {
    env: pythonEnv(),
  });
  smoke.status === 0 && smoke.stdout.includes('오프라인')
    ? ok('에이전트 오프라인 실행')
    : bad('에이전트 오프라인 실행', (smoke.stderr || smoke.stdout).trim().split('\n').pop() ?? '');
}

/* ── 출력 ────────────────────────────────────────────────── */
console.log('');
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const mark = r.level === 'ok' ? c.green('✓') : r.level === 'warn' ? c.yellow('!') : c.red('✗');
  console.log(`${mark} ${r.name.padEnd(width)}  ${c.dim(r.detail)}`);
  if (r.fix) console.log(`  ${' '.repeat(width)}  → ${c.cyan(r.fix)}`);
}

const failures = results.filter((r) => r.level === 'bad');
console.log('');
if (failures.length === 0) {
  console.log(c.green('환경 정상. 작업을 시작하세요.'));
  process.exit(0);
}
console.log(c.red(`${failures.length}건 실패. 위의 → 를 따라 조치한 뒤 다시 npm run check 하세요.`));
process.exit(1);
