/**
 * 스크립트 공용 헬퍼.
 *
 * 이 파일의 존재 이유: Windows 3명 / macOS 1명이 **같은 한 줄**로 실행할 수 있어야 한다.
 * OS 차이(파이썬 실행 파일 위치, 인코딩 기본값, 경로 구분자)는 전부 여기서 흡수하고,
 * 바깥에서는 `npm run <name>` 하나만 보이게 한다.
 *
 * 셸 스크립트를 쓰지 않는다. Node 는 네 명 모두 이미 설치돼 있고 동작이 동일하다.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IS_WINDOWS = process.platform === 'win32';

/** 지원 범위. 이 밖이면 requirements 핀이 안 맞을 수 있다. */
export const PYTHON_MIN = [3, 11];
export const PYTHON_MAX = [3, 14];
export const NODE_MIN = 20;

/** OneDrive와 무관한 실행 상태 디렉터리. Python agent/config.py와 동일한 규칙이다. */
export function stateDir(env = process.env) {
  if (env.KG_STATE_DIR) return path.resolve(env.KG_STATE_DIR);
  let appDir;
  if (IS_WINDOWS) {
    appDir = path.join(env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'graph-agent');
  } else if (process.platform === 'darwin') {
    appDir = path.join(homedir(), 'Library', 'Application Support', 'graph-agent');
  } else {
    appDir = path.join(env.XDG_STATE_HOME ?? path.join(homedir(), '.local', 'state'), 'graph-agent');
  }
  const projectKey = createHash('sha256').update(ROOT, 'utf8').digest('hex').slice(0, 16);
  return path.join(appDir, projectKey);
}

/** 상태 파일 경로를 돌려주고, 예전 OneDrive 위치의 파일은 최초 한 번 이전한다. */
export function stateFile(name, env = process.env) {
  const dir = stateDir(env);
  const target = path.join(dir, name);
  if (existsSync(target)) return target;

  mkdirSync(dir, { recursive: true });
  const legacyFiles = [
    path.join(path.dirname(dir), name),
    path.join(ROOT, 'agent', 'state', name),
  ];
  const legacy = legacyFiles.find((candidate) => existsSync(candidate));
  if (legacy) copyFileSync(legacy, target);
  return target;
}

/* ── 출력 ───────────────────────────────────────────────── */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  dim: (s) => paint('90', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  cyan: (s) => paint('36', s),
  bold: (s) => paint('1', s),
};

export function heading(text) {
  console.log(`\n${c.bold(text)}`);
}

/* ── 파이썬 찾기 ────────────────────────────────────────── */

/** venv 안의 파이썬 경로. Windows 는 Scripts, 나머지는 bin. */
export function venvPython() {
  return IS_WINDOWS
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
}

export function venvExists() {
  return existsSync(venvPython());
}

/**
 * venv 를 만들 시스템 파이썬을 찾는다.
 *
 * Windows 에서 "파이썬이 깔려 있는데 못 찾는" 경우가 세 가지 있다:
 *   1. 설치 후 터미널을 새로 열지 않아 PATH 가 갱신되지 않음
 *   2. pyenv-win / 일부 conda 처럼 python 이 .bat/.cmd 심 인 경우
 *      — Node 의 spawn 은 shell:false 로 .bat 을 실행하지 못한다 (ENOENT)
 *   3. Microsoft Store 앱 실행 별칭(스텁) — 실행하면 스토어가 열린다
 *
 * 2번을 위해 shell 폴백을 두고, 3번은 "거부" 가 아니라 "후순위" 로 둔다.
 * 실제로 설치된 Store 파이썬은 대개 동작하므로, 다른 후보가 없으면 그거라도 쓴다.
 *
 * 반환: { chosen, attempts } — 실패해도 attempts 로 원인을 보여줄 수 있다.
 */
export function findSystemPython() {
  // 공백이 없는 프로브. shell:true 폴백에서 따옴표 문제가 생기지 않게 한다.
  const PROBE =
    'import sys;print(sys.version_info[0]);print(sys.version_info[1]);print(sys.executable)';

  const candidates = IS_WINDOWS
    ? [
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
        ['py', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

  const attempts = [];
  const found = [];

  for (const [cmd, prefix] of candidates) {
    // shell:false 우선, 실패하면 Windows 에서 .bat/.cmd 심 을 위해 shell:true 재시도
    for (const useShell of IS_WINDOWS ? [false, true] : [false]) {
      const probe = spawnSync(cmd, [...prefix, '-c', PROBE], {
        encoding: 'utf-8',
        shell: useShell,
        windowsHide: true,
      });

      const label = `${cmd} ${prefix.join(' ')}`.trim() + (useShell ? ' (shell)' : '');

      if (probe.error) {
        attempts.push({ label, result: probe.error.code ?? probe.error.message });
        continue;
      }
      if (probe.status !== 0 || !probe.stdout?.trim()) {
        const why = (probe.stderr ?? '').trim().split(/\r?\n/)[0] || `종료코드 ${probe.status}`;
        attempts.push({ label, result: why });
        continue;
      }

      const [major, minor, executable = ''] = probe.stdout.trim().split(/\r?\n/);
      const isStore = executable.includes('WindowsApps');
      attempts.push({
        label,
        result: `Python ${major}.${minor}${isStore ? ' (Microsoft Store)' : ''} — ${executable}`,
      });

      found.push({
        cmd,
        prefix,
        useShell,
        major: Number(major),
        minor: Number(minor),
        executable: executable.trim(),
        isStore,
      });
      break; // 이 명령어는 찾았으니 shell 재시도 불필요
    }
  }

  // Store 가 아닌 것을 우선한다. 없으면 Store 라도 쓴다.
  const chosen = found.find((f) => !f.isStore) ?? found[0] ?? null;
  return { chosen, attempts };
}

/* ── .env ───────────────────────────────────────────────── */

/**
 * .env 를 읽어 객체로 돌려준다. 의존성을 추가하지 않기 위해 직접 판다.
 * 파일이 없으면 빈 객체 — 키가 없는 세 명도 그대로 동작해야 한다.
 */
export function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return {};

  const out = {};
  // utf-8 BOM 이 붙어 있어도 첫 키 이름이 깨지지 않게 제거한다 (Windows 편집기 대비)
  const text = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * 파이썬 자식 프로세스에 넘길 환경변수.
 *
 * PYTHONUTF8 / PYTHONIOENCODING 이 핵심이다. 한국어 Windows 의 기본 인코딩은
 * cp949 라서, 이걸 켜지 않으면 UTF-8 로 저장된 대화·노트·그래프 JSON 을 읽는
 * 순간 UnicodeDecodeError 가 나거나 글자가 깨진다. macOS 에서는 재현되지 않는다.
 */
export function pythonEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    ...loadDotEnv(),
    ...extra,
  };
}

/* ── 실행 ───────────────────────────────────────────────── */

/** 출력을 그대로 흘려보내며 실행. 종료 코드를 돌려준다. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (res.error) {
    console.error(c.red(`실행 실패: ${cmd} — ${res.error.message}`));
    return 1;
  }
  return res.status ?? 1;
}

/** 출력을 문자열로 받아 실행. 화면에 찍지 않는다. */
export function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: false,
    ...opts,
  });
  return {
    status: res.error ? 1 : (res.status ?? 1),
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? (res.error ? res.error.message : ''),
  };
}

/* ── 계약 잠금 ──────────────────────────────────────────── */

/** 계약 잠금이 감시하는 파일. 타입 정의만 본다. 문서는 보지 않는다. */
export const CONTRACT_FILES = ['contract/schema.py', 'contract/schema.ts'];
export const CONTRACT_LOCK = path.join(ROOT, 'contract', '.lock');

export function contractHashes() {
  const out = {};
  for (const rel of CONTRACT_FILES) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) {
      out[rel] = 'MISSING';
      continue;
    }
    // 줄바꿈과 BOM 을 정규화한 뒤 해시한다. Windows 체크아웃에서 CRLF 로 바뀌어도
    // 내용이 같으면 같은 해시가 나와야 한다.
    const text = readFileSync(abs, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    out[rel] = createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
  }
  return out;
}

export function readContractLock() {
  if (!existsSync(CONTRACT_LOCK)) return null;
  try {
    return JSON.parse(readFileSync(CONTRACT_LOCK, 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}
