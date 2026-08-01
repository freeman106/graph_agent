/**
 * 브라우저에서 에이전트를 돌리기 위한 개발 서버 미들웨어.
 *
 * 별도 서버를 두지 않는다. vite 가 이미 서버이므로 거기에 두 개만 붙인다:
 *
 *   GET  /api/agent/status   이 개발 서버가 실제 실행을 할 수 있는지
 *   POST /api/agent/run      대화 텍스트를 받아 실행하고 계약 C 이벤트를 SSE 로 흘린다
 *
 * **키가 없는 사람에게 오류가 나면 안 된다.** status 가 available:false 를 돌려주고
 * 프론트는 그때 목 데이터로 흐른다. 토글을 두지 않는 이유가 이것 — 사람이 켜고 끄면
 * 잘못 켠 상태로 데모하게 된다. 환경이 스스로 답하게 한다.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadDotEnv, pythonEnv, ROOT, venvExists, venvPython } from './lib.mjs';

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

// 그래프 상태가 JSON 파일 하나라 동시에 두 번 돌리면 서로를 덮어쓴다.
let running = false;

export function agentApi() {
  return {
    name: 'kg-agent-api',
    configureServer(server) {
      server.middlewares.use('/api/agent/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ...probe(), running }));
      });

      // 실행이 끝난 뒤 프론트가 결과 그래프를 받아간다.
      // 이벤트만으로 그래프를 재구성하지 않는다 — 저장소가 정본이고,
      // 화면이 그걸 그대로 읽는 편이 어긋날 여지가 없다.
      server.middlewares.use('/api/agent/graph', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        try {
          const raw = readFileSync(path.join(ROOT, 'agent', 'state', 'graph.json'), 'utf-8');
          res.end(raw.replace(/^﻿/, ''));
        } catch {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: '아직 실행 결과가 없습니다.' }));
        }
      });

      server.middlewares.use('/api/agent/run', async (req, res) => {
        const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

        const state = probe();
        if (!state.available) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(state));
          return;
        }
        if (running) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '이미 실행 중입니다.' }));
          return;
        }

        let text = '';
        try {
          const raw = await readBody(req);
          text = raw ? (JSON.parse(raw).text ?? '') : '';
        } catch {
          text = '';
        }
        if (!text.trim()) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '대화 텍스트가 비어 있습니다.' }));
          return;
        }

        // 붙여넣은 텍스트를 파일로 넘긴다. stdin 은 JSONL 출력과 섞이면 곤란하다.
        const dir = mkdtempSync(path.join(tmpdir(), 'kg-run-'));
        const textPath = path.join(dir, 'conversation.txt');
        writeFileSync(textPath, text, 'utf-8');

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        running = true;
        const child = spawn(
          venvPython(),
          ['-X', 'utf8', '-m', 'agent.main', '--stream-json', '--conversation-text', textPath],
          { cwd: ROOT, env: pythonEnv() },
        );

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
          running = false;
          if (code === 0) {
            send({ type: 'done' });
          } else {
            send({ type: 'error', code, message: stderr.trim().slice(-800) });
          }
          res.end();
        });

        req.on('close', () => {
          if (!child.killed) child.kill();
          running = false;
        });
      });
    },
  };
}
