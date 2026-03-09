# LuckyDesk 시스템 아키텍처

> 관련 문서: [시스템 개요](./00-overview.md) | [데이터베이스 설계](./02-database-design.md) | [구글 동기화](./04-google-sync.md)

---

## 1. 아키텍처 개요

LuckyDesk는 **Electron** 기반의 데스크탑 애플리케이션으로, 두 개의 핵심 프로세스(Main Process, Renderer Process)가 IPC(Inter-Process Communication)를 통해 통신하는 구조입니다.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Windows OS                                   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Electron Application                         │ │
│  │                                                                 │ │
│  │  ┌──────────────────────┐    IPC     ┌────────────────────────┐ │ │
│  │  │   Main Process       │◄──────────►│   Renderer Process     │ │ │
│  │  │   (main.js)          │            │   (renderer.js)        │ │ │
│  │  │                      │            │                        │ │ │
│  │  │  ┌────────────────┐  │            │  ┌──────────────────┐  │ │ │
│  │  │  │  db.js          │  │            │  │  FullCalendar    │  │ │ │
│  │  │  │  (SQLite)       │  │            │  │  (Calendar UI)   │  │ │ │
│  │  │  └────────────────┘  │            │  └──────────────────┘  │ │ │
│  │  │                      │            │                        │ │ │
│  │  │  ┌────────────────┐  │            │  ┌──────────────────┐  │ │ │
│  │  │  │ google-sync.js  │  │            │  │  Modal / UI      │  │ │ │
│  │  │  │ (Google API)    │  │            │  │  Components      │  │ │ │
│  │  │  └────────────────┘  │            │  └──────────────────┘  │ │ │
│  │  │                      │            │                        │ │ │
│  │  │  ┌────────────────┐  │            │  ┌──────────────────┐  │ │ │
│  │  │  │  System Tray    │  │            │  │  style.css       │  │ │ │
│  │  │  │  (Tray Icon)    │  │            │  │  (Glassmorphism) │  │ │ │
│  │  │  └────────────────┘  │            │  └──────────────────┘  │ │ │
│  │  └──────────────────────┘            └────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────┐  ┌───────────────────────┐  ┌────────────────────────┐ │
│  │ luckydesk │  │ Google Calendar API    │  │      Desktop           │ │
│  │   .db     │  │ Google Tasks API       │  │    (Wallpaper Layer)   │ │
│  └──────────┘  └───────────────────────┘  └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. 프로세스 구조

### 2.1 Main Process (`main.js`)

Electron의 메인 프로세스로, Node.js 환경에서 실행됩니다. 시스템 레벨 작업을 담당합니다.

**핵심 역할:**

| 역할 | 설명 |
|------|------|
| **BrowserWindow 관리** | 위젯 창 생성, 투명도/크기/위치 관리 |
| **IPC 핸들러** | 렌더러와의 양방향 통신 처리 |
| **데이터베이스 접근** | SQLite CRUD 작업 중계 |
| **구글 동기화 조율** | Google Calendar/Tasks API 호출 조율 |
| **시스템 트레이** | 트레이 아이콘 및 컨텍스트 메뉴 관리 |
| **윈도우 설정** | 창 위치/크기 복원, always-on-top 등 |

**BrowserWindow 설정 옵션:**

```javascript
{
    transparent: true,          // 창 배경 투명
    frame: false,               // 기본 타이틀바 제거
    hasShadow: false,           // 창 그림자 제거
    skipTaskbar: true,          // 작업표시줄에서 숨김
    resizable: true,            // 네이티브 리사이즈 활성 (set-editable로 동적 토글)
    movable: true,              // 창 이동 가능 (set-editable로 동적 토글)
    alwaysOnTop: false,         // 일반 윈도우 레벨
    type: 'toolbar',            // Windows에서 작업표시줄 미표시
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
        nodeIntegration: true,  // renderer에서 Node.js 사용
        contextIsolation: false // preload 없이 직접 접근 (⚠️ 보안 주의)
    }
}
```

> ⚠️ `contextIsolation: false`는 Electron 보안 가이드에서 권장하지 않는 설정입니다. 현재는 개발 편의를 위해 비활성화하고 있으며, 향후 `preload.js`를 도입하여 `contextBridge` 기반으로 전환하는 것을 권장합니다.

**부가 설정** (createWindow 내부):

```javascript
// Renderer 프로세스 로그 포워딩
win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (line ${line})`);
});
```

### 2.2 Renderer Process (`renderer.js`)

웹 페이지 환경에서 실행되는 프론트엔드 프로세스입니다.

**핵심 역할:**

| 역할 | 설명 |
|------|------|
| **FullCalendar 렌더링** | 캘린더 UI 초기화 및 렌더링 |
| **이벤트 핸들링** | 날짜/이벤트 클릭, 더블클릭 처리 |
| **모달 관리** | 일정 추가/수정, 설정 모달 제어 |
| **RRule 처리** | 반복 일정 규칙 파싱 및 인스턴스 전개 |
| **위젯 인터랙션** | 리사이즈, 투명도 조절, 마우스 관통 |
| **뷰 전환** | 월간/주간/일간 뷰 전환 |

---

## 3. IPC 통신 설계

Main Process와 Renderer Process 간의 통신은 두 가지 패턴을 사용합니다:

- **비동기 요청/응답**: `ipcMain.handle()` / `ipcRenderer.invoke()` — 반환값이 필요한 경우
- **단방향 메시지**: `ipcMain.on()` / `ipcRenderer.send()` — 반환값이 불필요한 경우

### 3.1 IPC 채널 목록

#### 데이터베이스 관련 (handle/invoke)

| 채널 | 방향 | 설명 | 요청 파라미터 | 응답 |
|------|------|------|---------------|------|
| `get-events` | Renderer → Main | 일정 목록 조회 | `{ start, end }` (선택) | `Event[]` |
| `add-event` | Renderer → Main | 일정 추가 | `EventData` | `number` (생성된 ID) |
| `update-event` | Renderer → Main | 일정 수정 | `EventData` (id 포함) | `RunResult` |
| `delete-event` | Renderer → Main | 일정 삭제 | `number` (id) | `RunResult` |
| `get-settings` | Renderer → Main | 설정 조회 | 없음 | `Settings` |

#### 구글 동기화 관련 (handle/invoke)

| 채널 | 방향 | 설명 | 요청 파라미터 | 응답 |
|------|------|------|---------------|------|
| `sync-google` | Renderer → Main | 전체 동기화 실행 | 없음 | `{ status, message? }` |
| `get-calendars` | Renderer → Main | 캘린더 목록 조회 | 없음 | `Calendar[]` |

#### 윈도우 제어 관련 (on/send)

| 채널 | 방향 | 설명 | 요청 파라미터 |
|------|------|------|---------------|
| `set-ignore-mouse` | Renderer → Main | 클릭 관통 설정 | `boolean` |
| `set-window-bounds` | Renderer → Main | 창 크기/위치 변경 | `{ width?, height?, x_delta?, y_delta? }` |
| `close-app` | Renderer → Main | 앱 종료 | 없음 |
| `set-editable` | Renderer → Main | 편집 모드 토글 (resizable/movable) | `boolean` |
| `update-setting` | Renderer → Main | 설정 값 업데이트 | `{ key, value, deleteEvents? }` |
| `reset-app` | Renderer → Main | 앱 전체 초기화 | 없음 |

#### Main → Renderer 알림 (webContents.send)

| 채널 | 방향 | 설명 | 트리거 |
|------|------|------|--------|
| `open-settings` | Main → Renderer | 설정 모달 열기 | 시스템 트레이 "설정" 메뉴 클릭 |
| `events-updated` | Main → Renderer | 이벤트 데이터 갱신 알림 | 동기화 해제, 앱 초기화 시 |

### 3.2 IPC 통신 시퀀스 다이어그램

#### 일정 추가 흐름

```
Renderer                    Main Process                 SQLite DB           Google API
   │                            │                           │                    │
   │  invoke('add-event', data) │                           │                    │
   │───────────────────────────►│                           │                    │
   │                            │  db.addEvent(data)        │                    │
   │                            │──────────────────────────►│                    │
   │                            │           newId           │                    │
   │                            │◄──────────────────────────│                    │
   │                            │                           │                    │
   │                            │  pushToGoogleIfEnabled()  │                    │
   │                            │───────────────────────────┼───────────────────►│
   │                            │                           │        OK          │
   │                            │◄──────────────────────────┼────────────────────│
   │                            │  db.updateGoogleId()      │                    │
   │                            │──────────────────────────►│                    │
   │          newId             │                           │                    │
   │◄───────────────────────────│                           │                    │
```

#### 구글 동기화 흐름

```
Renderer                    Main Process                 Google API          SQLite DB
   │                            │                           │                    │
   │  invoke('sync-google')     │                           │                    │
   │───────────────────────────►│                           │                    │
   │                            │  authorize()              │                    │
   │                            │──────────────────────────►│                    │
   │                            │         token             │                    │
   │                            │◄──────────────────────────│                    │
   │                            │                           │                    │
   │                            │  listEvents()             │                    │
   │                            │──────────────────────────►│                    │
   │                            │       events[]            │                    │
   │                            │◄──────────────────────────│                    │
   │                            │                           │                    │
   │                            │  listTasks()              │                    │
   │                            │──────────────────────────►│                    │
   │                            │       tasks[]             │                    │
   │                            │◄──────────────────────────│                    │
   │                            │                           │                    │
   │                            │        Upsert 로직        │                    │
   │                            │───────────────────────────┼───────────────────►│
   │                            │                           │                    │
   │  { status: 'success' }     │                           │                    │
   │◄───────────────────────────│                           │                    │
```

---

## 4. 모듈 설계

### 4.1 모듈 의존성 다이어그램

```
                    ┌──────────────┐
                    │   main.js    │
                    │ (Entry Point)│
                    └──────┬───────┘
                           │
                ┌──────────┼──────────┐
                │          │          │
                ▼          ▼          ▼
        ┌──────────┐ ┌──────────┐ ┌───────────────┐
        │  db.js   │ │ google-  │ │  Electron     │
        │(Database)│ │ sync.js  │ │  (BrowserWindow│
        └──────────┘ │(Google   │ │   Tray, IPC)  │
                     │ API)     │ └───────────────┘
                     └─────┬────┘
                           │
                           ▼
                     ┌──────────┐
                     │  db.js   │
                     │(Settings)│
                     └──────────┘
```

### 4.2 각 모듈 상세

#### `main.js` — 메인 프로세스 코어

| 책임 | 구현 |
|------|------|
| 윈도우 생성 | `createWindow()` — BrowserWindow 인스턴스 생성 및 설정 |
| 트레이 관리 | `app.whenReady()` 내에서 Tray 인스턴스 생성 |
| IPC 라우팅 | `ipcMain.handle()` / `ipcMain.on()` 으로 채널별 핸들러 등록 |
| 동기화 헬퍼 | `pushToGoogleIfEnabled()` — 로컬 변경 사항을 구글에 반영 |
| 로그 포워딩 | Renderer `console-message` → Main 프로세스 콘솔 출력 |
| 설정 관리 | `update-setting` / `set-editable` — 동적 설정 변경 처리 |

#### `db.js` — 데이터베이스 추상화 레이어

| 책임 | 구현 |
|------|------|
| 테이블 관리 | 앱 시작 시 `CREATE TABLE IF NOT EXISTS` |
| 스키마 마이그레이션 | `addColumn()` 으로 기존 테이블에 컬럼 추가 |
| CRUD 동작 | `getEvents()`, `addEvent()`, `updateEvent()`, `deleteEvent()` |
| 설정 관리 | `getSettings()`, `updateSetting()` |
| 동기화 데이터 | `clearGoogleSyncData()`, `resetApp()` |

> 상세 스키마: [02-database-design.md](./02-database-design.md)

#### `google-sync.js` — 구글 API 연동

| 책임 | 구현 |
|------|------|
| OAuth 인증 | `authorize()` — 토큰 관리 및 자동 갱신 |
| 토큰 획득 | `getNewTokenAutomatic()` — 로컬 HTTP 서버 콜백 방식 |
| 캘린더 조회 | `getCalendars()` — 사용자 캘린더 목록 |
| 이벤트 CRUD | `listEvents()`, `addEvent()`, `updateEvent()`, `deleteEvent()` |
| Tasks 조회 | `listTasks()` — Google Tasks 목록 (읽기 전용) |

> 상세 설계: [04-google-sync.md](./04-google-sync.md)

#### `renderer.js` — UI 로직

| 책임 | 구현 |
|------|------|
| 캘린더 초기화 | FullCalendar 인스턴스 생성 및 설정 |
| 이벤트 전개 | `expandRecurringEvent()` — RRule 기반 반복 인스턴스 생성 |
| 모달 제어 | `openModal()` — 일정 추가/수정 모달 표시 |
| 반복 규칙 | `getRecurrenceRule()`, `parseRecurrenceRule()` |
| 위젯 조작 | 리사이즈, 마우스 관통, 편집 모드 토글 |

#### `forge.config.js` — 빌드 설정

| 항목 | 설정 |
|------|------|
| ASAR 패킹 | `asar: true` |
| Windows 인스톨러 | `@electron-forge/maker-squirrel` |
| 보안 퓨즈 | `RunAsNode: false`, `CookieEncryption: true` 등 |

---

## 5. 데이터 흐름

### 5.1 로컬 일정 CRUD 흐름

```
[사용자 입력] → [renderer.js] → IPC → [main.js] → [db.js] → SQLite
                                                    ↓
                                          [google-sync.js] → Google API
                                            (양방향 동기화 활성 시)
```

### 5.2 구글 동기화 흐름

```
[동기화 버튼 클릭] → [renderer.js] → IPC('sync-google')
                                          ↓
                                    [main.js]
                                       ↓
                         ┌─────────────┼─────────────┐
                         ↓                           ↓
                 [google-sync.js]               [google-sync.js]
                    listEvents()                  listTasks()
                         ↓                           ↓
                    Google Calendar             Google Tasks
                      API 응답                    API 응답
                         ↓                           ↓
                         └─────────────┬─────────────┘
                                       ↓
                                 Upsert 로직
                              (기존 = 업데이트,
                              신규 = 추가)
                                       ↓
                                  [db.js] → SQLite
                                       ↓
                          { status: 'success' }
```

---

## 6. 보안 아키텍처

### 6.1 보안 계층

| 계층 | 보안 조치 |
|------|-----------|
| **인증** | OAuth 2.0 (Google) — 사용자 비밀번호 미저장 |
| **토큰 저장** | `userData` 디렉토리에 `token.json` 저장 (OS 보호 영역) |
| **자격증명** | `.env` 파일로 API 키 관리 (빌드 시 `credentials.json` 자동 생성) |
| **소스 보호** | JavaScript Obfuscation (배포 빌드 시) |
| **Electron Fuses** | `RunAsNode: false`, `CookieEncryption: true`, `NodeOptionsEnvironmentVariable: false` |
| **패키징** | ASAR 아카이브로 소스 번들링 |

### 6.2 환경 변수 관리

```
.env (비밀, .gitignore)
  ├── GOOGLE_CLIENT_ID
  ├── GOOGLE_PROJECT_ID
  └── GOOGLE_CLIENT_SECRET
         ↓
  scripts/generate-credentials.js
         ↓
  credentials.json (빌드 시 자동 생성)
```

---

## 7. 비기능 요구사항

| 항목 | 요구사항 |
|------|----------|
| **성능** | 앱 시작 시간 3초 이내, 캘린더 뷰 전환 100ms 이내 |
| **메모리** | 유휴 상태 150MB 이하 |
| **호환성** | Windows 10 이상 |
| **가용성** | 오프라인에서도 로컬 일정 관리 가능 |
| **확장성** | 단일 사용자 데스크탑 앱 (멀티 유저 불필요) |
