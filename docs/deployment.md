# 배포 안내

[프로젝트 소개로 돌아가기](../README.md)

이 문서는 저장소의 배포 구조와 해커톤 당시 Railway 배포 기록을 정리합니다.
[AGENTS.md](../AGENTS.md)의 배포·컨테이너 제외 규칙은 초기 24시간 범위 설정이며,
기존 구현에서 배포는 예외로 진행했습니다.

## 별도 서버가 필요한 이유

`npm run build`는 정적 프론트 파일을 만듭니다. Vite 개발 미들웨어에 붙은
`/api/agent/*`는 정적 빌드에 포함되지 않으므로 배포용 서버가 필요합니다.

현재 구조는 다음 조건을 전제로 합니다.

- Python 서브프로세스로 에이전트를 실행합니다.
- 강의안 처리 중 연결을 유지하고 SSE로 이벤트를 전달합니다.
- 그래프와 실행 기록을 파일에 저장합니다.

이 구조를 유지하기 위해 상시 구동 컨테이너와 영속 볼륨을 사용합니다.
다른 실행 환경으로 옮길 때는 요청 수명, 서브프로세스 지원, 상태 저장 방식을 함께 검토해야 합니다.

## 서버 구성

[scripts/serve.mjs](../scripts/serve.mjs)는 `dist/`와 `/api/agent/*`를 같은 오리진에서 제공합니다.
[scripts/agent-api.mjs](../scripts/agent-api.mjs)의 핸들러를 Vite와 `node:http` 서버가 공유합니다.
프론트는 상대 API 경로를 사용하므로 별도의 API 주소나 CORS 설정 없이 두 환경을 연결합니다.

서버는 기본적으로 접속자별 세션을 분리하고, 긴 실행 중 15초마다 SSE 하트비트를 보냅니다.
이 하트비트는 유휴 연결 차단을 줄이기 위한 처리이며, 모델 진행 상태를 보장하거나 실행 시간 제한을 대신하지 않습니다.

로컬에서 배포 구조를 확인하려면:

```text
npm run build
npm run start
```

기본 포트는 `8080`입니다. 외부에 노출할 때는 아래 접근 제어 관련 한계를 확인하세요.
`npm run preview`는 정적 파일만 제공하므로 API 동작 확인에는 사용하지 않습니다.

## Docker

```text
docker build -t graphmind .
docker run --env-file .env -p 8080:8080 -v kg-state:/app/agent/state graphmind
```

실제 모델 실행 시 `.env`에 본인의 `OPENAI_API_KEY`가 필요합니다.
`.env`는 [.dockerignore](../.dockerignore)로 빌드 컨텍스트에서 제외되며,
위 예시는 컨테이너 실행 시 환경변수로 주입합니다. 배포 플랫폼에서는 환경변수 설정을 사용하세요.

이미지는 Node.js 22와 Python 3.11을 사용합니다. 빌드 중 계약 검사와 프론트 빌드를 수행하고,
런타임에는 Node 표준 모듈 서버, Python 환경, 프론트 빌드를 복사합니다.
`output/pdf/`는 프론트가 가져오는 소스 자산이므로 이미지 빌드에서 제외하지 않습니다.

상태 경로는 이미지에서 `KG_STATE_DIR=/app/agent/state`로 고정합니다.
이 위치에 볼륨을 연결해야 컨테이너 교체·재배포 후에도 상태를 유지할 수 있습니다.

## Railway 배포 기록

다음은 해커톤 당시 사용한 명령입니다. CLI의 최신 동작을 보증하는 설치 안내는 아닙니다.

```text
npm i -g @railway/cli
railway login
railway init --name knowledge-graph
railway up --ci -y --service knowledge-graph
railway variables set OPENAI_API_KEY --stdin --skip-deploys
railway domain
```

API 키는 stdin으로 전달합니다. 키 값을 명령에 직접 적거나 커밋하지 않습니다.
`railway up`은 소스를 올려 원격에서 Dockerfile로 빌드하므로 필요한 소스 자산이 배포 입력에 포함되어야 합니다.

대시보드에서 다음을 설정했습니다.

- Volume을 `/app/agent/state`에 마운트.
- 서비스 인스턴스를 1개로 고정.

당시 Railway CLI 5.30.3의 `railway volume add`에서 패닉이 발생해 대시보드로 볼륨을 설정했습니다.
Railway가 Dockerfile의 `VOLUME` 지시어를 거부해 해당 지시어를 제거하고 플랫폼에서 볼륨을 연결했습니다.
이는 당시 확인한 배포 문제와 조치에 관한 기록입니다.

## 환경변수

| 이름 | 기본값 | 역할 |
|---|---|---|
| `OPENAI_API_KEY` | 없음 | 실제 모델 실행. 없으면 브라우저는 샘플 데이터로 동작 |
| `PORT` | `8080` | HTTP 서버 포트 |
| `HOST` | `0.0.0.0` | 서버 바인딩 주소 |
| `KG_SESSIONS` | 켜짐 | 접속 세션별 상태 분리. `0`이면 세션 분리 해제 |
| `KG_MAX_CONCURRENT_RUNS` | `2` | 동시에 실행할 에이전트 서브프로세스 수 |
| `KG_STATE_DIR` | 이미지에서 `/app/agent/state` | 상태 저장 루트. 세션·과목별 하위 디렉터리 사용 |
| `KG_MODE` | `dev` | 개발용·시연용 모델 설정 선택 |
| `KG_MODEL_DEV`, `KG_MODEL_DEMO` | [agent/config.py](../agent/config.py) 참조 | 실행 모델 변경 |
| `KG_MAX_STEPS_LECTURE` | `80` | 강의안 실행의 모델 호출 상한. 대화 상한은 코드에서 20 |

## 지속 운영 시 필요한 작업

- **여러 인스턴스 지원:** 현재 실행 잠금이 프로세스 메모리에 있으므로 상태와 잠금을 공유하는 구조가 필요합니다.
- **상태 보존:** 영속 볼륨 없이 컨테이너를 교체하면 그래프·실행 기록이 유실될 수 있습니다.
- **접근·사용량 제어:** 주소를 아는 사용자가 모델 실행을 요청할 수 있습니다. 세션 분리와 동시 실행 수 제한은 인증이나 비용 상한이 아닙니다.
- **상태 정리:** 세션 디렉터리가 자동 삭제되지 않으므로 보관·정리 정책이 필요합니다.
- **긴 입력 처리:** 강의안 텍스트의 자동 분할이 없어 모델 컨텍스트를 넘는 입력을 처리할 수 없습니다.
