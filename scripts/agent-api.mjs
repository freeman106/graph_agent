/**
 * 브라우저에서 에이전트를 돌리기 위한 HTTP 핸들러.
 *
 *   GET  /api/agent/status   이 서버가 실제 실행을 할 수 있는지 (키 유무)
 *   GET  /api/agent/graph    결과 그래프 JSON (?subjectId=)
 *   POST /api/agent/run      대화 텍스트를 받아 실행하고 계약 C 이벤트를 SSE 로 흘린다
 *   POST /api/agent/lecture  강의안 실행. 빈 그래프에서 시작한다
 *   POST /api/agent/question 선택한 노트 문장에 실제 모델 답변을 받는다
 *   POST /api/agent/share    ChatGPT 공유 URL → 대화 텍스트
 *   GET  /api/agent/undo     되돌릴 스냅샷이 있는지 · POST 면 되돌린다
 *   GET  /api/agent/redo     다시 실행할 스냅샷이 있는지 · POST 면 되돌린다
 *
 * **키가 없는 사람에게 오류가 나면 안 된다.** status 가 available:false 를 돌려주고
 * 프론트는 그때 목 데이터로 흐른다. 토글을 두지 않는 이유가 이것 — 사람이 켜고 끄면
 * 잘못 켠 상태로 데모하게 된다. 환경이 스스로 답하게 한다.
 *
 * 이 파일은 서버를 만들지 않는다. `(req, res) => boolean` 하나만 돌려준다.
 * 개발은 vite 미들웨어가(vite.config.ts), 배포는 node:http 가(scripts/serve.mjs)
 * **같은 함수**를 마운트한다. "dev 에선 되는데 배포에선 안 되는" 경로가 생기지 않는다.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadDotEnv,
  pythonEnv,
  ROOT,
  stateDir,
  stateFile,
  venvExists,
  venvPython,
} from './lib.mjs';
import { fetchSharedConversation } from './chatgpt-share.mjs';

const SESSION_COOKIE = 'kg_session';
const DEFAULT_SUBJECT_ID = 'deep-learning';

/**
 * 동시에 뜰 수 있는 파이썬 프로세스 수.
 *
 * 비용이 아니라 메모리 문제다. openai-agents + pydantic 를 얹은 프로세스 하나가
 * 150~200MB 를 쓰기 때문에, 공개 주소에서 동시에 여러 개가 뜨면 컨테이너가 OOM 으로
 * 죽는다. 상한을 넘으면 프론트에 이미 있는 "실행을 시작하지 못했습니다" 로 흐른다.
 */
const MAX_CONCURRENT_RUNS = Number(process.env.KG_MAX_CONCURRENT_RUNS || 2);

function normalizeSubjectId(value) {
  const id = String(value ?? DEFAULT_SUBJECT_ID).trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(id) ? id : DEFAULT_SUBJECT_ID;
}

/** 실행 가능 여부. 이유까지 돌려줘야 화면에서 안내할 수 있다. */
function probe() {
  if (!venvExists()) {
    return { available: false, reason: '.venv 가 없습니다. npm run setup 을 먼저 실행하세요.' };
  }
  const env = loadDotEnv();
  const key = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) {
    return { available: false, reason: 'OPENAI_API_KEY 가 없습니다. 목 데이터로 동작합니다.' };
  }
  return { available: true, keyTail: key.slice(-4) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

const readGraphText = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').replace(/^﻿/, '') : null);

/** 실행 전후를 비교할 때 쓰는 지문. 학습 내용만 보고 부가 필드는 무시한다. */
function graphFingerprint(raw) {
  if (!raw) return JSON.stringify({ nodes: [], edges: [], chapters: [] });
  try {
    const graph = JSON.parse(raw);
    return JSON.stringify({
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      chapters: graph.chapters ?? [],
    });
  } catch {
    return raw;
  }
}

function graphIsEmpty(raw) {
  if (!raw) return true;
  try {
    const graph = JSON.parse(raw);
    return (graph.nodes?.length ?? 0) === 0
      && (graph.edges?.length ?? 0) === 0
      && (graph.chapters?.length ?? 0) === 0;
  } catch {
    return false;
  }
}

/**
 * 계약 C 이벤트를 브라우저로 옮기는 API.
 *
 * @param sessions 접속자마다 그래프를 따로 둘지.
 *   개발(false)에서는 stateDir() 하나를 그대로 쓴다 — 켜버리면 팀원이
 *   `npm run agent` 로 만든 그래프를 `npm run dev` 화면에서 볼 수 없게 된다.
 *   배포(true)에서는 켠다. 상태가 JSON 파일 하나라 두 사람이 같은 경로를 쓰면
 *   서로를 덮어쓰기 때문이다.
 */
export function createAgentApi({ sessions = false } = {}) {
  // 세션 id -> 그 세션이 지금 에이전트를 돌리고 있는지. 프로세스 메모리라
  // 인스턴스 하나를 전제한다 (인스턴스를 늘리면 여기가 제일 먼저 깨진다).
  const running = new Set();

  // 살아 있는 파이썬 자식 수. 실행과 질문이 같이 센다 — 메모리를 먹는 건 둘 다다.
  let liveProcesses = 0;

  /**
   * 세션을 쿠키로 서버가 심는다.
   *
   * 프론트가 `/api/...` 를 같은 오리진으로 부르므로 쿠키가 자동으로 실려 온다.
   * 그래서 src/ 를 한 줄도 고치지 않고 접속자별 격리가 된다.
   */
  function resolveSession(req, res) {
    if (!sessions) return { id: 'local', root: stateDir() };

    const jar = req.headers.cookie ?? '';
    const hit = jar
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    let id = hit?.slice(SESSION_COOKIE.length + 1) ?? '';

    // 16진수 32자만 받는다. 값이 그대로 디렉터리 이름이 되므로 경로가 될 수 있는
    // 문자는 애초에 통과시키지 않는다.
    if (!/^[0-9a-f]{32}$/.test(id)) {
      id = randomBytes(16).toString('hex');
      res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
      );
    }
    return { id, root: path.join(stateDir(), 'sessions', id) };
  }

  /**
   * 접속자(세션) × 과목(subject) 두 축을 하나의 상태 디렉터리로 접는다.
   *
   * 둘 다 결국 파이썬에 KG_STATE_DIR 로 넘어가므로 여기서 합쳐야 어긋나지 않는다.
   *   세션 off + 기본 과목 → stateFile()      예전 경로 그대로. 레거시 이관이 살아 있다
   *   세션 off + 다른 과목 → <상태>/subjects/<과목>
   *   세션 on  + 기본 과목 → <상태>/sessions/<세션>
   *   세션 on  + 다른 과목 → <상태>/sessions/<세션>/subjects/<과목>
   *
   * file() 로 그래프뿐 아니라 undo/redo 스냅샷 경로도 같이 받는다. 스냅샷이 그래프와
   * 다른 디렉터리에 떨어지면 되돌리기가 남의 그래프를 덮어쓴다.
   *
   * dir 이 null 이면 KG_STATE_DIR 을 주지 않는다는 뜻이다 — agent/config.py 의
   * 기본 경로와 레거시 이관을 그대로 쓰게 둔다.
   */
  function resolveTarget(session, subjectId) {
    if (subjectId === DEFAULT_SUBJECT_ID && !sessions) {
      return { dir: null, file: (name) => stateFile(name) };
    }
    const dir = subjectId === DEFAULT_SUBJECT_ID
      ? session.root
      : path.join(session.root, 'subjects', subjectId);
    return { dir, file: (name) => path.join(dir, name) };
  }

  const targetEnv = (target) =>
    target.dir ? pythonEnv({ KG_STATE_DIR: target.dir }) : pythonEnv();

  /**
   * 스냅샷 하나를 되돌리고, 되돌리기 전 상태를 반대편 스냅샷으로 남긴다.
   * undo 와 redo 가 서로의 반대편이라 같은 함수로 양방향을 처리한다.
   */
  function restoreGraphSnapshot(target, sourceName, inverseName) {
    const sourcePath = target.file(sourceName);
    if (!existsSync(sourcePath)) return null;
    const graphPath = target.file('graph.json');
    const currentExisted = existsSync(graphPath);
    const currentGraph = currentExisted ? readGraphText(graphPath) : null;
    const snapshot = JSON.parse(readFileSync(sourcePath, 'utf-8').replace(/^﻿/, ''));

    writeFileSync(
      target.file(inverseName),
      JSON.stringify({ existed: currentExisted, graph: currentGraph }),
      'utf-8',
    );
    if (snapshot.existed) {
      writeFileSync(graphPath, String(snapshot.graph ?? ''), 'utf-8');
    } else if (existsSync(graphPath)) {
      unlinkSync(graphPath);
    }
    unlinkSync(sourcePath);
    return snapshot.existed ? JSON.parse(snapshot.graph) : null;
  }

  function handleStatus(_req, res, session) {
    sendJson(res, 200, { ...probe(), running: running.has(session.id) });
  }

  // 실행이 끝난 뒤 프론트가 결과 그래프를 받아간다.
  // 이벤트만으로 그래프를 재구성하지 않는다 — 저장소가 정본이고,
  // 화면이 그걸 그대로 읽는 편이 어긋날 여지가 없다.
  function handleGraph(req, res, session) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const subjectId = normalizeSubjectId(url.searchParams.get('subjectId'));
      const raw = readFileSync(resolveTarget(session, subjectId).file('graph.json'), 'utf-8');
      res.end(raw.replace(/^﻿/, ''));
    } catch {
      // 아직 이 과목을 실행한 적이 없다. 프론트는 404 를 받으면 시드로 흐른다.
      sendJson(res, 404, { error: '아직 실행 결과가 없습니다.' });
    }
  }

  /**
   * 마지막 대화 실행을 과목별로 한 번 되돌리거나 되살린다.
   * GET 은 가능 여부만, POST 는 실제로 되돌리고 그래프를 돌려준다.
   */
  async function handleHistory(req, res, session, sourceName, inverseName, missingMessage) {
    try {
      if (running.has(session.id)) {
        sendJson(res, 409, { error: '실행 중에는 되돌릴 수 없습니다.' });
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET') {
        const target = resolveTarget(session, normalizeSubjectId(url.searchParams.get('subjectId')));
        sendJson(res, 200, { available: existsSync(target.file(sourceName)) });
        return;
      }

      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const target = resolveTarget(session, normalizeSubjectId(payload.subjectId));
      if (!existsSync(target.file(sourceName))) {
        sendJson(res, 404, { error: missingMessage });
        return;
      }
      sendJson(res, 200, { graph: restoreGraphSnapshot(target, sourceName, inverseName) });
    } catch (error) {
      sendJson(res, 500, { error: error.message ?? missingMessage });
    }
  }

  async function handleShare(req, res) {
    try {
      const body = await readBody(req);
      const { url } = JSON.parse(body || '{}');
      const result = await fetchSharedConversation(url ?? '');
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message ?? '공유 링크를 읽지 못했습니다.' });
    }
  }

  /** 노트에서 고른 문장에 대한 단발 질문. 그래프 상태를 읽지 않는다(agent/qa.py). */
  async function handleQuestion(req, res) {
    const state = probe();
    if (!state.available) {
      sendJson(res, 409, state);
      return;
    }
    if (liveProcesses >= MAX_CONCURRENT_RUNS) {
      sendJson(res, 503, { error: '지금 다른 실행이 몰려 있습니다. 잠시 뒤 다시 시도해 주세요.' });
      return;
    }

    let counted = false;
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      if (!String(payload.question ?? '').trim() || !String(payload.quote ?? '').trim()) {
        sendJson(res, 400, { error: '질문과 선택 문장이 필요합니다.' });
        return;
      }

      liveProcesses += 1;
      counted = true;
      const child = spawn(venvPython(), ['-X', 'utf8', '-m', 'agent.qa'], {
        cwd: ROOT,
        env: pythonEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
      child.stdin.end(JSON.stringify(payload));

      const code = await new Promise((resolve) => child.on('close', resolve));
      if (code !== 0) throw new Error(stderr.trim().slice(-800) || '모델 답변을 받지 못했습니다.');
      sendJson(res, 200, JSON.parse(stdout.replace(/^﻿/, '')));
    } catch (error) {
      sendJson(res, 500, { error: error.message ?? '질문 처리에 실패했습니다.' });
    } finally {
      if (counted) liveProcesses -= 1;
    }
  }

  async function runAgent(req, res, session, buildArgs, trackUndo) {
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    const state = probe();
    if (!state.available) {
      sendJson(res, 409, state);
      return;
    }
    if (running.has(session.id)) {
      sendJson(res, 409, { error: '이미 실행 중입니다.' });
      return;
    }
    if (liveProcesses >= MAX_CONCURRENT_RUNS) {
      sendJson(res, 503, { error: '지금 다른 실행이 몰려 있습니다. 잠시 뒤 다시 시도해 주세요.' });
      return;
    }

    let text = '';
    let subjectId = DEFAULT_SUBJECT_ID;
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      text = payload.text ?? '';
      subjectId = normalizeSubjectId(payload.subjectId);
    } catch {
      text = '';
    }
    if (!text.trim()) {
      sendJson(res, 400, { error: '대화 텍스트가 비어 있습니다.' });
      return;
    }

    // 붙여넣은 텍스트를 파일로 넘긴다. stdin 은 JSONL 출력과 섞이면 곤란하다.
    const dir = mkdtempSync(path.join(tmpdir(), 'kg-run-'));
    const textPath = path.join(dir, 'conversation.txt');
    writeFileSync(textPath, text, 'utf-8');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // 리버스 프록시(nginx 등)가 응답을 모았다 보내면 실시간 스트림이 아니게 된다.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const target = resolveTarget(session, subjectId);
    const graphPath = target.file('graph.json');
    const graphExistedBefore = existsSync(graphPath);
    const graphBefore = readGraphText(graphPath);

    // 새로 만든 과목은 시드가 아니라 빈 그래프에서 출발해야 한다. 안 그러면
    // 과목을 만들자마자 남의 지도(딥러닝 시드)가 섞여 들어온다.
    const childArgs = buildArgs(textPath);
    const needsEmptyGraph = subjectId !== DEFAULT_SUBJECT_ID && !graphExistedBefore;
    if (needsEmptyGraph && !childArgs.includes('--empty')) childArgs.unshift('--empty');

    running.add(session.id);
    liveProcesses += 1;
    const child = spawn(
      venvPython(),
      ['-X', 'utf8', '-m', 'agent.main', ...childArgs],
      { cwd: ROOT, env: targetEnv(target) },
    );

    // 모델이 오래 생각하는 구간에서는 아무것도 흐르지 않는다. 그 침묵을 끊긴
    // 연결로 보고 닫는 중간 장비가 있어서 주기적으로 주석 줄을 보낸다.
    // 프론트 파서는 `data: ` 로 시작하는 줄만 보므로 그대로 무시된다.
    // (측정값: Railway 는 아무것도 안 흐르는 스트림을 300 초에 끊는다.)
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      running.delete(session.id);
      liveProcesses -= 1;
    };

    // stdout 은 JSONL 이다. 줄이 잘려 올 수 있으므로 개행 기준으로 모았다 흘린다.
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          send({ type: 'event', event: JSON.parse(line) });
        } catch {
          send({ type: 'log', text: line });
        }
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('close', (code) => {
      release();
      // 스냅샷 저장이 실패해도 실행 결과까지 잃으면 안 된다. 되돌리기는 부가 기능이다.
      if (trackUndo) {
        try {
          const graphAfter = readGraphText(graphPath);
          if (graphFingerprint(graphBefore) !== graphFingerprint(graphAfter)) {
            if (target.dir) mkdirSync(target.dir, { recursive: true });
            writeFileSync(
              target.file('graph.undo.json'),
              JSON.stringify({ existed: graphExistedBefore, graph: graphBefore }),
              'utf-8',
            );
            const redoPath = target.file('graph.redo.json');
            if (existsSync(redoPath)) unlinkSync(redoPath);
          } else if (!graphExistedBefore && graphAfter !== null && graphIsEmpty(graphAfter)) {
            // 첫 실행 준비용 빈 파일도 무관한 입력 뒤에는 남기지 않는다.
            unlinkSync(graphPath);
          }
        } catch {
          /* 스냅샷을 못 남겨도 실행 자체는 성공으로 돌려준다 */
        }
      }
      if (code === 0) {
        send({ type: 'done' });
      } else {
        send({ type: 'error', code, message: stderr.trim().slice(-800) });
      }
      res.end();
    });

    req.on('close', () => {
      if (!child.killed) child.kill();
      release();
    });
  }

  /** 처리했으면 true. 아니면 false 를 돌려 바깥이 다음 처리를 하게 둔다. */
  return function handle(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/api/agent/')) return false;

    const session = resolveSession(req, res);

    switch (pathname) {
      case '/api/agent/status':
        handleStatus(req, res, session);
        return true;
      case '/api/agent/graph':
        handleGraph(req, res, session);
        return true;
      case '/api/agent/share':
        void handleShare(req, res);
        return true;
      case '/api/agent/question':
        void handleQuestion(req, res);
        return true;
      case '/api/agent/undo':
        void handleHistory(
          req, res, session,
          'graph.undo.json', 'graph.redo.json',
          '취소할 마지막 실행이 없습니다.',
        );
        return true;
      case '/api/agent/redo':
        void handleHistory(
          req, res, session,
          'graph.redo.json', 'graph.undo.json',
          '다시 실행할 기록이 없습니다.',
        );
        return true;
      case '/api/agent/run':
        // 대화 실행 — 기존 그래프에 개념을 더한다. 되돌리기 대상이다.
        void runAgent(req, res, session, (textPath) => [
          '--stream-json',
          '--conversation-text',
          textPath,
        ], true);
        return true;
      case '/api/agent/lecture':
        // 강의안 실행 — 빈 그래프에서 시작해 단원·소주제·노드·문서를 만든다.
        // 대화 실행과 배관이 같아 같은 핸들러를 쓰고 인자만 다르게 준다.
        // 그래프를 통째로 새로 세우는 실행이라 되돌리기 대상이 아니다.
        void runAgent(req, res, session, (textPath) => [
          '--stream-json',
          '--empty',
          '--lecture',
          textPath,
        ], false);
        return true;
      default:
        sendJson(res, 404, { error: '없는 엔드포인트입니다.' });
        return true;
    }
  };
}

/** vite 개발 서버용 플러그인. 위 핸들러를 미들웨어로 걸기만 한다. */
export function agentApi() {
  const handle = createAgentApi({ sessions: false });
  return {
    name: 'kg-agent-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handle(req, res)) next();
      });
    },
  };
}
