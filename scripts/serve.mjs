/**
 * npm run start — 배포용 서버.
 *
 * vite 는 개발 서버다. `npm run build` 는 정적 파일만 만들고 `/api/agent/*` 는
 * 사라진다. 그래서 배포에는 이 파일이 필요하다. 하는 일은 두 가지뿐이다:
 *
 *   1. dist/ 를 정적으로 서빙한다
 *   2. scripts/agent-api.mjs 의 핸들러를 같은 오리진에 건다
 *
 * **같은 오리진인 것이 중요하다.** 프론트는 `fetch('/api/agent/status')` 처럼
 * 상대 경로로 부른다(src/agentApi.ts). 정적 호스팅과 API 를 다른 주소에 두면
 * src/ 에 기준 주소를 넣어야 하는데 거기는 C 담당이고, CORS 와 쿠키까지 딸려 온다.
 * 한 서버가 둘 다 내보내면 그 전부가 없던 일이 된다.
 *
 * 프레임워크를 쓰지 않는 이유: 하는 일이 정적 파일과 라우트 다섯 개뿐이라
 * express 를 넣으면 런타임 의존성만 늘어난다. 이 파일은 node 표준 모듈만 쓴다.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { createAgentApi } from './agent-api.mjs';
import { c, ROOT, stateDir } from './lib.mjs';

const DIST = path.join(ROOT, 'dist');

// 호스트가 넘겨주는 포트를 그대로 쓴다 (Railway·Fly·Render·Cloud Run 모두 PORT 다).
const PORT = Number(process.env.PORT || 8080);
// 컨테이너 밖에서 접속하려면 루프백이 아니라 모든 인터페이스에 붙어야 한다.
const HOST = process.env.HOST || '0.0.0.0';

// 배포에서는 접속자마다 그래프를 따로 둔다. 상태가 JSON 파일 하나라 두 사람이
// 같은 경로를 쓰면 서로를 덮어쓴다. 시연을 한 그래프로 하고 싶으면 KG_SESSIONS=0.
const SESSIONS = process.env.KG_SESSIONS !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // pdfjs 워커가 .mjs 로 나온다. 이걸 빠뜨리면 PDF 읽기가 통째로 죽는다.
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`${c.red('✗')} dist/ 가 없습니다. 먼저 ${c.cyan('npm run build')} 를 실행하세요.`);
  process.exit(1);
}

const handleApi = createAgentApi({ sessions: SESSIONS });

/** dist/ 안의 파일 하나를 내보낸다. 없으면 false. */
function sendFile(res, abs) {
  let info;
  try {
    info = statSync(abs);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', info.size);
  // 해시가 붙은 자산은 내용이 바뀌면 이름이 바뀐다. index.html 은 그렇지 않으므로
  // 캐시하면 배포 후에도 옛 화면이 뜬다.
  res.setHeader(
    'Cache-Control',
    abs.startsWith(path.join(DIST, 'assets') + path.sep)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  createReadStream(abs).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  if (handleApi(req, res)) return;

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }

  // 공개 주소라 경로 탈출을 막는다. join 뒤에 dist 안인지 다시 확인한다 —
  // `..` 을 문자열로 걸러내는 것보다 결과를 보는 편이 확실하다.
  const abs = path.join(DIST, rel);
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }

  if (rel !== '/' && sendFile(res, abs)) return;

  // 나머지는 전부 SPA 진입점으로 보낸다.
  if (sendFile(res, path.join(DIST, 'index.html'))) return;

  res.statusCode = 404;
  res.end('not found');
});

// 강의안 실행이 1~3분 걸린다. node 기본 타임아웃은 이보다 짧게 잡히는 경우가 있어
// SSE 가 도중에 끊긴다. 0 은 서버가 스스로 끊지 않는다는 뜻이다.
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`${c.green('✓')} http://localhost:${PORT} 에서 서비스 중`);
  console.log(`  ${c.dim(`세션별 그래프 격리: ${SESSIONS ? '켜짐' : '꺼짐 (그래프 하나를 공유)'}`)}`);
  // 볼륨을 어디에 붙여야 하는지가 이 한 줄로 드러난다. KG_STATE_DIR 을 주지 않으면
  // OS 별 앱 데이터 경로라(scripts/lib.mjs) 컨테이너에서는 마운트하기 어색하다.
  console.log(`  ${c.dim(`상태 디렉터리: ${stateDir()}`)}`);
});
