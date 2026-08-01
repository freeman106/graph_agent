"""에이전트 패키지.

한국어 Windows 방어가 여기 있다.

한국어 Windows 의 기본 인코딩은 cp949 다. 그 상태로 UTF-8 로 저장된 대화·노트·
그래프 JSON 을 읽으면 UnicodeDecodeError 가 나거나 글자가 깨지고, 한국어를
print 하면 UnicodeEncodeError 로 죽는다. macOS 에서는 재현되지 않는다.

정상 경로(`npm run agent`)에서는 런처가 PYTHONUTF8=1 을 넣어주지만, 누군가
파이썬을 직접 부를 수도 있으므로 여기서 한 번 더 막는다. 이 모듈은 agent 를
import 하는 순간 실행된다.
"""

from __future__ import annotations

import sys

for _stream in (sys.stdout, sys.stderr):
    # PYTHONIOENCODING 이 없어도 콘솔 출력이 깨지지 않게 한다.
    _reconfigure = getattr(_stream, "reconfigure", None)
    if _reconfigure is not None:
        try:
            _reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

#: 파일을 **읽을** 때 쓴다. Windows 편집기가 붙인 UTF-8 BOM 을 조용히 걷어낸다.
#: BOM 이 없으면 utf-8 과 동일하게 동작한다.
READ_ENCODING = "utf-8-sig"

#: 파일을 **쓸** 때 쓴다. BOM 을 붙이지 않는다.
WRITE_ENCODING = "utf-8"

__all__ = ["READ_ENCODING", "WRITE_ENCODING"]
