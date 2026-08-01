# 지식그래프 학습 도우미

공부한 대화를 통째로 붙여넣으면, 에이전트가 다룬 개념을 뽑아 기존 지식그래프에
자동으로 연결하고 어디서 막혔는지까지 짚어낸 노트를 만든다.

> **작업 규칙은 [AGENTS.md](AGENTS.md)에 있다. 코드를 건드리기 전에 먼저 읽는다.**

---

## 클론 직후 할 일

**Windows / macOS 모두 명령이 동일하다.** 아래 세 줄이 전부다.

```
npm install
npm run setup
npm run check
```

`npm run check`가 `환경 정상`을 찍으면 준비 완료다. 실패하면 무엇이 왜 틀렸는지와
다음에 할 일이 같이 나온다. 그대로 따르고 다시 `npm run check`.

### 사전 준비 — Windows

1. **Node.js LTS** — [nodejs.org](https://nodejs.org) 에서 설치.
   설치 후 **터미널을 새로 연다** (PATH 반영).
2. **Python 3.11 ~ 3.13** — [python.org](https://www.python.org/downloads/windows/) 에서 설치.
   설치 화면에서 **"Add python.exe to PATH" 를 반드시 체크한다.**
   - ⚠️ **Microsoft Store 버전은 쓰지 않는다.** 가상환경 생성이 실패한다.
     `python`을 쳤을 때 스토어가 열리면 그게 스토어 스텁이다.
   - 터미널은 **PowerShell 또는 명령 프롬프트** 아무거나 좋다. Git Bash도 된다.
3. **Git** — [git-scm.com](https://git-scm.com/download/win).
   설치 중 줄바꿈 옵션은 무엇을 골라도 된다. `npm run setup`이 이 저장소에 맞게
   다시 잡아준다.

확인:

```
node -v
py -3 --version
```

### 사전 준비 — macOS

1. **Node.js LTS** — `brew install node` 또는 [nodejs.org](https://nodejs.org)
2. **Python 3.11 ~ 3.13** — `brew install python@3.13`

확인:

```
node -v
python3 --version
```

---

## 각자 첫 세션 시작하기

저장소 폴더에서 Claude Code 또는 Codex CLI를 연다. 규칙은 자동으로 로드된다
(`CLAUDE.md` → Claude Code, `AGENTS.md` → Codex CLI. 둘은 같은 내용을 가리킨다).

**자기 역할을 첫 프롬프트로 선언한다.** 아래를 그대로 복사해서 쓰면 된다.

<details>
<summary><b>A — 에이전트 코어</b></summary>

```
나는 A(에이전트 코어) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 agent/ 이고, contract/ 의 소유자도 나다.
지금 할 일: agent/main.py 의 스트림 변환기를 실제 OpenAI 응답으로 검증하고,
계약 C 이벤트가 정확히 나오는지 확인한다.
시작 전에 npm run check 를 돌려 환경부터 확인해라.
```
</details>

<details>
<summary><b>B — 그래프 엔진</b></summary>

```
나는 B(그래프 엔진) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 agent/store.py 와 agent/tools.py 뿐이다. 다른 폴더는 읽기만 한다.
contract/README.md 의 계약 B(툴 시그니처)를 먼저 읽어라.
지금 할 일: store.py 의 NotImplementedError 로 남아 있는 get_neighbors,
link_nodes, merge_nodes, mark_progress 를 구현하고 tools.py 에 래퍼를 추가한다.
툴 안에서 LLM 을 호출하지 마라. search_nodes 는 임베딩을 쓰지 않는다.
확인은 npm run agent:offline 로 한다. API 키는 필요 없다.
```
</details>

<details>
<summary><b>C — 프론트 + 스트림</b></summary>

```
나는 C(프론트) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 src/ 뿐이다. agent/ 와 contract/ 는 읽기만 한다.
타입은 contract/schema.ts 에서 import 한다. 새로 선언하지 마라.
contract/README.md 의 계약 A(그래프)와 계약 C(스트림)를 먼저 읽어라.
지금 할 일: 실행 스트림 뷰에 raw 뷰 / 요약 뷰 토글을 붙인다.
요약 층이 비고 raw 만 있는 이벤트가 순수 원본 통과분이다.
실제 이벤트 예시는 agent/state/last_run.jsonl 에 있다. API 키는 필요 없다.
```
</details>

<details>
<summary><b>D — 노트 + 발표물</b></summary>

```
나는 D(노트/발표물) 담당이다. AGENTS.md 4절의 담당 표를 지켜라.
내 영역은 contract/fixtures/ 와 발표 자료뿐이다. 코드는 읽기만 한다.
contract/README.md 의 Weakpoint / Evidence 구조를 먼저 읽어라.
지금 할 일: 약점 탐지 프롬프트를 다듬고, 시연용 그래프에 쓸 대화 픽스처를
추가한다. Weakpoint 의 네 칸(description/misconception/correction/evidence)이
프론트 노트 패널에 그대로 렌더링된다.
contract/schema.py 와 schema.ts 는 건드리지 마라. 소유자는 A 다.
```
</details>

## 매일 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 프론트 개발 서버 → http://localhost:5173 |
| `npm run agent:offline` | **API 키 없이** 에이전트 실행 |
| `npm run agent` | 에이전트 실행 (API 키 필요, A 담당자만) |
| `npm run check` | 환경 진단. 뭔가 이상하면 제일 먼저 |
| `npm run contract:check` | 계약 검사만 빠르게 |

`npm run dev`와 `npm run agent`는 실행 전에 계약 검사를 통과해야 한다.
계약이 깨진 상태로는 작업을 시작할 수 없다.

### API 키

키는 **A 담당자 한 명만** 가진다. 나머지 세 명은 키 없이 개발한다.

- 백엔드 → `npm run agent:offline`
- 프론트 → `src/mock.ts` 목 데이터, 또는 `agent/state/last_run.jsonl`의 실제 이벤트 기록

키를 가진 사람은 `.env`에 넣는다 (`npm run setup`이 만들어 둔다):

```
OPENAI_API_KEY=sk-...
```

`.env`는 절대 커밋되지 않는다. `npm run check`가 추적 여부를 감시한다.

---

## 구조

```
contract/          팀 데이터 계약. 단일 진실 원본. 소유자 외 수정 금지
  README.md          계약 A(그래프) / B(툴) / C(스트림) 설명
  schema.py          pydantic 모델 — 원본
  schema.ts          동일 타입의 TS 사본
  .lock              계약 잠금 해시. 무단 변경을 자동으로 잡는다
  fixtures/          시드 그래프 · 확인용 대화 · 용어 사전

agent/             에이전트 코어 (A) + 그래프 엔진 (B) — Python
src/               프론트 (C) — Vite + React + TypeScript
scripts/           OS 차이를 흡수하는 실행 스크립트 (A)
```

담당별로 읽을 계약은 `contract/README.md` 상단 표에 있다.

---

## 시연

```
npm run dev
```

1. 시작 상태 — 22개 노드가 채워진 트랜스포머 지식그래프
2. `contract/fixtures/kv_cache_conversation.json`의 대화를 textarea에 붙여넣기
   (또는 우측 하단 `샘플 대화 붙여넣기` 링크)
3. **3단계**에서 새 노드가 관계 라벨과 함께 그래프에 붙는 장면
4. **6단계**에서 에이전트가 자기 결과의 문제를 스스로 잡아 그래프에 반영하는 장면
5. 주황색 **KV Cache** 노드 클릭 → 막혔던 지점 / 정정 전·후 / 근거 인용

---

## 배포

> AGENTS.md 8절은 배포 설정을 만들지 않는다고 되어 있다. 그건 24시간 제약 기준이고,
> **배포는 예외로 진행한다.** 나머지 규칙은 그대로다.

### 왜 컨테이너인가

`npm run build`는 정적 파일만 만든다. `/api/agent/*`는 vite 개발 서버에 붙어 있던
미들웨어라 빌드 결과물에는 존재하지 않는다. 그래서 배포에는 서버가 따로 필요하고,
그 서버는 세 가지를 동시에 만족해야 한다:

1. **파이썬 서브프로세스를 띄운다** — Python 3.11~3.14 + `agent/requirements.txt`
2. **요청을 1~3분 붙들고 있는다** — 강의안 실행은 모델 호출 최대 80턴
3. **파일에 쓴다** — 그래프 상태가 JSON 파일 하나다

Vercel Functions 같은 서버리스는 2·3을 만족하지 못한다. 요청이 끝나면 프로세스가
사라지고 `/tmp` 밖은 쓸 수 없어서 그래프가 매번 없어진다. 상시 구동 컨테이너가 답이다.

### 서버

`scripts/serve.mjs`가 `dist/`와 `/api/agent/*`를 **같은 오리진**에서 내보낸다.
프론트가 `fetch('/api/agent/status')`처럼 상대 경로로 부르기 때문에, 둘을 다른 주소에
두면 `src/`에 기준 주소를 넣고 CORS까지 다뤄야 한다. 한 서버가 둘 다 맡으면 그게 없다.

라우트 핸들러는 `scripts/agent-api.mjs` 하나이고 개발 서버와 배포 서버가 그걸 같이
쓴다. "dev에선 되는데 배포에선 안 되는" 경로가 생기지 않는다.

로컬에서 배포본 그대로 확인하려면:

```
npm run build
npm run start
```

### 컨테이너

```
docker build -t knowledge-graph .
docker run -p 8080:8080 -e OPENAI_API_KEY=sk-... -v kg-state:/app/agent/state knowledge-graph
```

**`.env`는 이미지에 안 들어간다** (`.dockerignore`). 키는 항상 호스트의 환경변수로 넣는다.

### Railway에 올리기

컨테이너를 받아주는 곳이면 어디든 같은 Dockerfile로 올라간다. 실제로 확인한 순서다:

```
npm i -g @railway/cli
railway login
railway init --name knowledge-graph
railway up --ci -y --service knowledge-graph
railway variables set OPENAI_API_KEY --stdin --skip-deploys   (값은 stdin 으로)
railway domain
```

`railway up`은 **이미지가 아니라 소스를 올린다.** Railway 쪽에서 이 Dockerfile로
직접 빌드하므로, 로컬에만 있고 커밋되지 않은 파일이 있으면 거기서 깨진다.

남은 두 가지는 웹 대시보드에서 한다:

- **Volume을 `/app/agent/state`에 마운트한다.** CLI의 `railway volume add`는
  5.30.3 에서 패닉한다(`Option::unwrap()` on a `None`). 대시보드에서는 정상이다.
  안 붙이면 재배포·재시작 때 그래프가 사라진다. 시연만 할 거면 없어도 된다.
- **인스턴스 수를 1로 고정한다.** 아래 "알려진 한계" 참고.

Fly.io(`fly launch` → `fly volumes create`)나 자체 VM도 절차만 다르고 내용은 같다.

### 환경변수

| 이름 | 기본값 | 하는 일 |
|---|---|---|
| `OPENAI_API_KEY` | 없음 | 없으면 `status`가 `available:false`를 돌려주고 **화면은 목 데이터로 뜬다.** 오류가 나지 않는다 |
| `PORT` | `8080` | 호스트가 넘겨주는 걸 쓴다 |
| `KG_SESSIONS` | 켜짐 | 접속자마다 그래프를 따로 둔다. `0`이면 전원이 그래프 하나를 공유(1인 시연용) |
| `KG_MAX_CONCURRENT_RUNS` | `2` | 동시에 뜰 수 있는 파이썬 프로세스 수 |
| `KG_STATE_DIR` | 이미지에서 `/app/agent/state` | 상태 디렉터리. **이미지가 고정해 둔다** — 안 박으면 OS별 앱 데이터 경로(`~/.local/state/graph-agent/<해시>`)라 볼륨을 어디에 붙일지 알 수 없다. 서버는 접속자마다 이 밑의 `sessions/<id>/`를 파이썬에 넘긴다 |
| `KG_MODE` / `KG_MODEL_DEV` / `KG_MODEL_DEMO` | `agent/config.py` | 모델 전환 |

### 알려진 한계

배포본을 그대로 쓰기 전에 알고 있어야 하는 것들이다.

- **인스턴스는 하나여야 한다.** 동시 실행을 막는 플래그가 프로세스 메모리에 있어서,
  인스턴스를 늘리면 같은 사람의 두 실행이 서로 다른 인스턴스에 붙어 그래프를 덮어쓴다.
  여기를 넘으려면 상태를 파일에서 공유 저장소로 옮겨야 한다 — `store.py`(B 담당) 개조다.
- **볼륨을 안 붙이면 재배포할 때 그래프가 사라진다.** 시연만 할 거면 그래도 된다.
- **주소를 아는 사람은 누구나 실행할 수 있다.** 접근 제어가 없다. `KG_MAX_CONCURRENT_RUNS`는
  메모리를 지키는 장치지 비용을 막는 장치가 아니다. 시연이 끝나면 내리거나 키를 회수한다.
- **세션 디렉터리는 자동으로 지워지지 않는다.** `agent/state/sessions/<id>/`가 접속자마다
  쌓인다. 하나에 수십 KB라 시연 규모에서는 문제가 안 되지만, 오래 띄워 둘 거면 지워야 한다.
- **긴 강의안을 자르지 않는다.** 수십만 자를 넣으면 모델 컨텍스트가 넘친다. 배포 이전부터
  있던 문제이고 서버가 따로 막지 않는다.

---

## 문제가 생기면

**`npm run check`를 먼저 돌린다.** 대부분 원인과 조치가 같이 나온다.

| 증상 | 원인과 조치 |
|---|---|
| `쓸 수 있는 Python 을 찾지 못했습니다` | 시도한 명령과 결과가 같이 출력된다. 전부 `ENOENT` 면 PATH 문제 → **터미널을 새로 열어라** (설치 직후 PATH가 반영 안 됨). 그래도 안 되면 그 출력을 A에게 보낼 것 |
| `.venv 생성 실패` | Microsoft Store 파이썬. python.org 버전으로 재설치 |
| `Python 패키지 ... ≠ ...` | `npm run setup` 다시 |
| `한국어 인코딩 왕복` 실패 | 파이썬을 직접 불렀다. `npm run agent`를 쓴다 |
| `계약 위반` | AGENTS.md 2절. 자기가 고쳤으면 `git checkout -- contract/` |
| 리베이스에서 파일 전체가 변경으로 잡힘 | `npm run setup` 다시 (git 설정을 잡아준다) |
| 파일 안의 한글이 `占쏙옙`으로 보임 | 그 파일이 cp949/BOM으로 저장됐다. UTF-8(BOM 없음)로 다시 저장 |

### Windows 전용

| 증상 | 원인과 조치 |
|---|---|
| PowerShell에서 `npm : 이 시스템에서 스크립트를 실행할 수 없으므로` | 실행 정책 차단. **명령 프롬프트(cmd)를 쓰거나** `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| 콘솔 출력의 한글만 깨져 보임 (파일은 멀쩡) | 콘솔 코드페이지가 949. **Windows Terminal**을 쓰거나 `chcp 65001` 먼저 실행. `npm run check`가 감지해서 알려준다 |
| `py` 를 찾을 수 없음 | Python 설치 시 py 런처를 뺐다. `python` 으로도 동작하니 `npm run setup` 을 그냥 돌려본다 |
| Python이 깔려 있는데 못 찾는다고 나옴 | 세 가지 중 하나다. ① 터미널을 안 새로 열어 PATH 미반영 ② pyenv-win 처럼 `python`이 `.bat` 심 ③ Microsoft Store 버전. `npm run check`가 시도한 명령과 결과를 전부 찍어주니 그걸 보면 구분된다 |
| venv 생성이나 pip 설치가 이상하게 실패 | 클론 경로에 한글/공백이 있을 수 있다. `C:\dev\graph_agent` 같은 영문 경로로 다시 클론. `npm run check`가 경고한다 |
| 설치가 비정상적으로 느림 | 백신 실시간 검사. 저장소 폴더를 예외로 등록하면 빨라진다 |
