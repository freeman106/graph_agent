# 개발 안내

[프로젝트 소개로 돌아가기](../README.md)

Windows와 macOS에서 같은 npm 명령을 사용합니다. Python 실행 파일 경로와
한국어 인코딩 차이는 `scripts/*.mjs`에서 처리하므로 에이전트는 Python을 직접 호출하지 않고 실행합니다.
코드를 변경하기 전에는 [AGENTS.md](../AGENTS.md)의 담당 경계와 계약 규칙을 확인하세요.

## 준비

권장 환경은 배포 이미지와 맞춘 **Node.js 22, Python 3.11, Git**입니다.
현재 환경 점검 스크립트가 허용하는 범위는 Node.js 20 이상, Python 3.11–3.14입니다.
이 범위 검사가 모든 버전 조합의 실행 검증을 대신하지는 않습니다.

### Windows

1. [Node.js](https://nodejs.org)를 설치하고 터미널을 새로 엽니다.
2. [Python](https://www.python.org/downloads/windows/) 설치 시 PATH 추가 옵션을 선택합니다.
3. [Git](https://git-scm.com/download/win)을 설치합니다.

PowerShell 또는 명령 프롬프트를 사용할 수 있습니다.
Python 명령이 Microsoft Store를 열기만 한다면 실제 Python 설치와 앱 실행 별칭을 확인하세요.

```text
node -v
py -3 --version
```

### macOS

Node.js와 Python을 설치한 뒤 버전을 확인합니다.

```text
node -v
python3 --version
```

## 최초 설치

```text
npm install
npm run setup
npm run check
```

`setup`은 `.venv` 생성, 고정된 Python 패키지 설치, `.env` 생성,
저장소 로컬 Git 설정(줄바꿈·경로·pull 방식)을 수행합니다.
`check`가 실패하면 출력된 원인과 조치를 확인하세요.

## 실행 명령

| 명령 | 동작 |
|---|---|
| `npm run dev` | 개발 서버. API 키가 없으면 샘플 화면, 있으면 실제 에이전트 API 사용 |
| `npm run agent:offline` | API 키 없이 고정 시나리오 실행. 로컬 그래프와 실행 기록 갱신 |
| `npm run agent` | 기본 대화 픽스처로 실제 모델 실행. API 키 필요 |
| `npm run dev:live` | CLI 실행이 저장한 그래프를 프론트의 초기 그래프로 표시 |
| `npm run agent:reset` | 로컬 그래프를 시드로 초기화하고 오프라인 실행. 기존 상태에 주의 |
| `npm run check` | 환경·패키지·한국어 인코딩·계약·픽스처·TypeScript 검사 |
| `npm run contract:check` | 계약 검사만 실행 |
| `npm run contract:seal` | 계약 변경 확정. 계약 소유자만 사용 |
| `npm run build` | 타입 검사 후 프론트 빌드 |
| `npm run start` | 빌드된 프론트와 에이전트 API를 제공하는 서버 |
| `npm run preview` | 정적 빌드 미리보기. 에이전트 API는 포함하지 않음 |

`dev`, `dev:live`, `agent` 계열 명령은 시작 전에 계약 검사를 실행합니다.
`dev:live`는 먼저 `agent` 또는 `agent:offline`으로 저장된 결과가 있어야 합니다.

## API 키와 모델 설정

실제 모델을 호출하려면 `.env`의 `OPENAI_API_KEY`에 본인의 키를 설정합니다.
키를 변경한 뒤에는 개발 서버를 다시 실행하세요. 키는 화면 캡처·로그·커밋에 포함하지 않습니다.
`.env`는 Git 추적 대상에서 제외되어 있으며 `npm run check`에서도 추적 여부를 검사합니다.

키가 없으면 브라우저는 샘플 데이터로 동작합니다. 샘플 시연은 입력 내용을 실제로 분석하는 기능과 다릅니다.
PDF의 실제 그래프 생성과 모델 기반 대화 처리는 키가 있을 때 사용할 수 있습니다.

모델 설정은 [agent/config.py](../agent/config.py)에 모여 있습니다.
`KG_MODEL_DEV`, `KG_MODEL_DEMO`, `KG_MODE`로 변경할 수 있으며, 설정한 모델의 사용 권한이 필요합니다.
해커톤 당시의 키 공유 방식과 역할별 안내는 [작업 기록](hackathon-notes.md)에 보존했습니다.

## 상태 파일

현재 기본 저장 위치는 저장소의 `agent/state/`가 아닌 **OS별 앱 데이터 디렉터리**입니다.
저장소 절대 경로의 해시로 작업 사본별 디렉터리를 나눕니다.

| 환경 | 기본 위치 |
|---|---|
| Windows | `%LOCALAPPDATA%/graph-agent/<저장소 경로 해시>/` |
| macOS | `~/Library/Application Support/graph-agent/<저장소 경로 해시>/` |
| Linux | `$XDG_STATE_HOME/graph-agent/<저장소 경로 해시>/` 또는 `~/.local/state/graph-agent/<저장소 경로 해시>/` |

`graph.json`은 그래프 상태, `last_run.jsonl`은 실행 이벤트 기록입니다.
`KG_STATE_DIR`를 설정하면 저장 위치를 바꿀 수 있습니다.
이전 위치의 상태가 있으면 최초 실행 때 옮기는 호환 처리가 있습니다.
배포 서버는 접속 세션·과목별로 경로를 더 나눕니다. 세부 설정은 [배포 안내](deployment.md)를 참고하세요.

## 코드 구조

| 경로 | 역할 |
|---|---|
| `contract/` | Python·TypeScript 공통 타입, 잠금 해시, 시드 그래프·대화 픽스처 |
| `agent/` | Agents SDK 실행, 도구, 그래프 저장 |
| `src/` | React 화면, PDF 텍스트 추출, 그래프 레이아웃, 스트림 클라이언트 |
| `scripts/` | 환경 점검·실행, 공통 API 핸들러, 배포 서버 |
| `output/pdf/` | 빌드에서 가져오는 시연용 PDF 소스 자산 |
| `slides/` | 발표 자료 소스 |

## 문제 해결

먼저 `npm run check`를 실행합니다.

| 증상 | 확인·조치 |
|---|---|
| Python을 찾지 못함 | 설치 후 터미널을 새로 열고 PATH 확인. 점검 결과의 시도한 명령과 오류 확인 |
| 가상환경 생성 실패 | 실제 Python 설치인지 확인. Microsoft Store 실행 별칭이나 경로 문제 점검 |
| Python 패키지 버전 불일치 | `npm run setup` 재실행 |
| 한국어 인코딩 왕복 실패 | Python 직접 호출 대신 `npm run agent` 사용. 파일 인코딩은 UTF-8로 저장 |
| 계약 위반 | 변경 diff 확인 후 계약 소유자와 Python·TS 정의 및 잠금 해시를 함께 검토 |
| 리베이스에서 파일 전체가 변경됨 | `npm run setup`으로 저장소 줄바꿈 설정 확인 |
| 파일 안의 한글이 깨짐 | 원본 인코딩을 확인해 복원한 뒤 UTF-8(BOM 없음)로 저장 |

### Windows에서 확인할 사항

| 증상 | 확인·조치 |
|---|---|
| PowerShell이 `npm.ps1` 실행을 차단 | 명령 프롬프트에서 실행하거나 조직의 실행 정책 확인 |
| 콘솔 출력의 한글만 깨짐 | Windows Terminal 사용 또는 `chcp 65001` 후 점검 |
| `py` 런처가 없음 | 설치한 `python` 명령을 사용할 수 있다면 `npm run setup`이 다른 후보도 탐색 |
| Python이 있는데 탐색 실패 | 새 터미널에서 PATH·앱 실행 별칭·pyenv 등의 실행 경로 확인 |
| 한글·공백 경로에서 설치 실패 | 점검 결과 확인 후 `C:\dev\graph_agent`처럼 단순한 경로에서 재시도 |

원인을 확인하지 않고 계약 파일이나 로컬 변경을 되돌리지 마세요.
