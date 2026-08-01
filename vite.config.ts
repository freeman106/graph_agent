import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error — scripts/ 는 타입 없는 순수 노드 스크립트다
import { agentApi } from './scripts/agent-api.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

/**
 * `npm run dev:live` 일 때만, 프론트가 읽는 시드 그래프를 에이전트가 실제로
 * 만든 그래프로 바꿔치기한다.
 *
 * 프론트는 `contract/fixtures/seed_graph.json` 을 정적으로 import 한다.
 * 그 파일을 덮으면 `--reset` 이 되돌릴 시드가 사라지므로, 파일을 건드리지 않고
 * import 해석 단계에서만 경로를 돌린다. src/ 는 한 줄도 바뀌지 않는다.
 *
 * 실제 실행 결과가 없으면(=아직 npm run agent 를 안 돌렸으면) 조용히 시드를 쓴다.
 */
function liveGraph(): Plugin {
  const live = path.join(ROOT, 'agent', 'state', 'graph.json')
  return {
    name: 'kg-live-graph',
    enforce: 'pre',
    resolveId(source) {
      if (!process.env.KG_LIVE) return null
      if (!source.replace(/\\/g, '/').endsWith('fixtures/seed_graph.json')) return null
      return existsSync(live) ? live : null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [agentApi(), liveGraph(), react(), tailwindcss()],
  // 저장소 밖이 아닌 agent/state 를 읽어야 하므로 허용 범위에 넣는다.
  server: { fs: { allow: [ROOT] } },
})
