# 배포 이미지. 호스트에 묶이지 않는다 — Railway / Fly / Render / 자체 VM 어디든
# 이 파일 하나로 동일하게 올라간다.
#
# 왜 컨테이너인가 (AGENTS.md 8 절의 예외):
#   1. 파이썬 서브프로세스를 띄운다. 호스트에 Python 3.11~3.14 + requirements 가 필요하다
#   2. 실행이 1~3 분이다. 요청이 끝나면 사라지는 실행 모델과 맞지 않는다
#   3. 그래프 상태가 쓰기 가능한 파일 하나다
# 이 셋을 한 번에 만족시키는 가장 짧은 방법이다.

# ── 1단계: 프론트를 빌드한다 ────────────────────────────────────
# 여기서만 node_modules 가 필요하다. 결과물인 dist/ 만 다음 단계로 넘긴다.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json index.html vite.config.ts ./
COPY scripts ./scripts
COPY contract ./contract
COPY src ./src
COPY public ./public
# 이름과 달리 산출물이 아니라 소스다. src/pdfNote.ts 가 시연용 강의안 PDF 를
# `?inline` 로 빌드 타임에 가져간다. 빠지면 빌드가 UNRESOLVED_IMPORT 로 죽는다.
COPY output ./output

# 계약이 깨진 채로 이미지가 만들어지면 배포 후에야 드러난다. 부팅이 아니라
# 빌드에서 막는다 — 실패한 이미지는 애초에 올라가지 않는 편이 낫다.
RUN npm run contract:check
RUN npm run build

# ── 2단계: 실제로 돌 이미지 ─────────────────────────────────────
# 런타임에 node_modules 가 없다. scripts/serve.mjs 는 node 표준 모듈만 쓰고
# dist/ 는 이미 정적 파일이다.
FROM node:22-bookworm-slim

# 한국어 Windows 대비로 넣는 것과 같은 설정이다. 컨테이너 안에서 파이썬을 직접
# 부를 일이 있을 때도 인코딩이 흔들리지 않게 이미지 수준에서 박아 둔다.
ENV PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production

# 상태 디렉터리를 못 박는다.
#
# 안 박으면 agent/config.py 와 scripts/lib.mjs 가 OS 별 앱 데이터 경로를 고른다.
# 리눅스에서는 /root/.local/state/graph-agent/<저장소경로해시> 가 되는데, 해시가
# 빌드 경로에 달려 있어서 볼륨을 어디에 붙여야 할지 사람이 알 수 없다.
# 여기서 고정하면 마운트 지점이 늘 같다.
ENV KG_STATE_DIR=/app/agent/state

# bookworm 의 python3 는 3.11 이다 (지원 범위 3.11~3.14 안).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requirements 를 먼저 넣어 레이어를 나눈다. 파이썬 의존성이 그대로면
# 코드만 고쳤을 때 이 무거운 단계를 다시 돌지 않는다.
COPY agent/requirements.txt ./agent/requirements.txt
RUN python3 -m venv .venv \
 && .venv/bin/pip install --no-cache-dir --upgrade pip \
 && .venv/bin/pip install --no-cache-dir -r agent/requirements.txt

# scripts/lib.mjs 의 venvPython() 이 /app/.venv/bin/python 을 찾는다.
# npm run setup 이 만드는 것과 같은 자리라 코드가 OS 를 구분할 필요가 없다.

COPY package.json ./
COPY scripts ./scripts
COPY contract ./contract
COPY agent ./agent
COPY --from=builder /app/dist ./dist

# 그래프 상태가 여기 쌓인다. **볼륨을 이 경로에 붙여야 재시작해도 남는다.**
# 안 붙이면 컨테이너 레이어에 쓰이고 재배포 때 사라진다 (시연만 할 거면 그래도 된다).
#
# VOLUME 지시어는 쓰지 않는다. Railway 가 이 지시어를 거부하고(자기네 볼륨을 쓰라고
# 한다), 어차피 선언하지 않아도 `docker run -v` 나 플랫폼 볼륨은 그대로 붙는다.
# 오히려 선언해 두면 플랫폼 볼륨 없이 docker run 했을 때 찾기 어려운 익명 볼륨이
# 생긴다. 마운트 지점을 정하는 것은 이미지가 아니라 배포하는 쪽의 일이다.
RUN mkdir -p /app/agent/state

# 호스트가 PORT 를 넘겨주면 그걸 쓴다. 안 넘어오면 8080.
EXPOSE 8080

CMD ["node", "scripts/serve.mjs"]
