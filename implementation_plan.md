# MyCalendar 구현 계획서

이 프로젝트의 목표는 FullCalendar를 사용해 일정을 관리하고, SQLite에 로컬 데이터를 저장하며, 구글 캘린더와 동기화되는 윈도우 데스크탑 배경화면 애플리케이션을 만드는 것입니다.

## 제안된 변경 사항

### [백엔드 / 메인 프로세스]

- Electron 메인 프로세스 설정 (배경화면 동작을 위한 투명도, 툴바 제거 등 설정).
- 데이터베이스 CRUD 작업을 위한 IPC 핸들러 구현.
- 구글 캘린더 동기화를 위한 OAuth2 인증 흐름 구현.

### [프런트엔드 / 렌더러 프로세스]

- Vite 기반의 환경 설정 (성능과 디자인을 위해 Vanilla JS 사용).
- 스타일 커스터마이징이 포함된 FullCalendar 통합.
- 일정 추가/수정/삭제를 위한 UI(모달 등) 생성.
- 동기화 버튼 및 상태 표시 기능 구현.

### [데이터 저장소]

- `better-sqlite3`를 사용한 SQLite 데이터베이스 설정.
- `events` 테이블 정의: `id`, `title`, `start`, `end`, `description`, `google_id`, `last_synced`.

---

### MyCalendar/ 폴더 구조

#### [NEW] [package.json](file:///d:/_Work/VibeCoding/MyCalendar/package.json)

- 의존성 정의: `electron`, `vite`, `fullcalendar`, `better-sqlite3`, `googleapis`.

#### [NEW] [main.js](file:///d:/_Work/VibeCoding/MyCalendar/main.js)

- Electron 엔트리 포인트. 윈도우 생성 및 IPC 통신 관리.

#### [NEW] [index.html](file:///d:/_Work/VibeCoding/MyCalendar/index.html)

- 메인 애플리케이션 쉘.

#### [NEW] [style.css](file:///d:/_Work/VibeCoding/MyCalendar/style.css)

- 프리미엄 다크 모드 및 글래스모피즘(Glassmorphism) 스타일 적용.

#### [NEW] [renderer.js](file:///d:/_Work/VibeCoding/MyCalendar/renderer.js)

- 캘린더 초기화 및 이벤트 핸들링.

#### [NEW] [db.js](file:///d:/_Work/VibeCoding/MyCalendar/db.js)

- SQLite 데이터베이스 추상화 레이어.

#### [NEW] [google-sync.js](file:///d:/_Work/VibeCoding/MyCalendar/google-sync.js)

- 구글 캘린더 API 연동 로직.

## 검증 계획

### 자동화 테스트

- 초기 프로토타입에서는 SQLite 지속성 확인을 위한 수동 테스트 위주로 진행.

### 수동 검증

- **로컬 CRUD**: 일정 추가 후 앱 재시작 시 데이터 유지 확인.
- **동기화**: 구글 계정 연결 후 구글 캘린더와 앱 간 데이터 상호 동기화 확인.
- **배경화면 레이아웃**: 데스크탑 배경에서의 투명도 및 위치 적절성 확인.

> [!IMPORTANT]
> 구글 캘린더 동기화를 위해서는 구글 클라우드 콘솔에서 발급받은 `credentials.json`이 필요합니다. 설정 방법은 추후 안내해 드리겠습니다.
