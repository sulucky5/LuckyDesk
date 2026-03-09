# LuckyDesk 구글 캘린더 동기화 설계

> 관련 문서: [시스템 아키텍처](./01-architecture.md) | [데이터베이스 설계](./02-database-design.md)

---

## 1. 개요

LuckyDesk는 **Google Calendar API v3**와 **Google Tasks API v1**을 사용하여 양방향 동기화를 지원합니다.

| 항목 | 내용 |
|------|------|
| **인증 방식** | OAuth 2.0 |
| **Calendar API** | v3 (읽기/쓰기) |
| **Tasks API** | v1 (읽기 전용) |
| **동기화 방향** | 양방향 (캘린더), 단방향 (Tasks: Google → 로컬) |
| **동기화 트리거** | 사용자 수동 (동기화 버튼 클릭) |
| **구현 모듈** | `google-sync.js` (GoogleSync 클래스) |

---

## 2. OAuth 2.0 인증 흐름

### 2.1 자격증명 관리

```
.env (비밀)
  ├── GOOGLE_CLIENT_ID
  ├── GOOGLE_PROJECT_ID
  └── GOOGLE_CLIENT_SECRET
         ↓
  scripts/generate-credentials.js
         ↓
  credentials.json (빌드 시 자동 생성)
```

### 2.2 OAuth Scope

| Scope | 용도 |
|-------|------|
| `calendar.events` | 캘린더 이벤트 읽기/쓰기 |
| `calendar.readonly` | 캘린더 목록 읽기 |
| `tasks.readonly` | Tasks 목록 읽기 |

**Scope 검증 로직**: `sync-google` 및 `get-calendars` 핸들러 실행 시 기존 저장된 토큰이 최신 Scope를 모두 포함하고 있는지 검사합니다. 필요한 Scope(`calendar.readonly` 또는 `tasks.readonly` 등)가 누락된 토큰인 경우, 즉시 토큰을 폐쇄(삭제)하고 사용자에게 재인증을 유도하여 권한 부족 오류를 방지합니다.

### 2.3 인증 시퀀스

```
사용자                  LuckyDesk                Google OAuth
  │                       │                        │
  │  (동기화 클릭)          │                        │
  │──────────────────────►│                        │
  │                       │  authorize()            │
  │                       │─ token.json 확인 ──►   │
  │                       │                        │
  │                       │  [토큰 없음 or 만료]     │
  │                       │  로컬 HTTP 서버 시작     │
  │                       │  (redirect_uri)         │
  │                       │                        │
  │                       │  브라우저에서 동의화면    │
  │  ◄──────────── 브라우저 열림 ────────────────►  │
  │  (구글 로그인 & 권한 승인)                       │
  │  ─────────────────────────────────────────────►│
  │                       │                        │
  │                       │  콜백 수신 (auth code)   │
  │                       │◄───────────────────────│
  │                       │                        │
  │                       │  getToken(code)         │
  │                       │───────────────────────►│
  │                       │         tokens          │
  │                       │◄───────────────────────│
  │                       │                        │
  │                       │  token.json 저장        │
  │                       │                        │
```

### 2.4 토큰 저장

| 파일 | 경로 | 내용 |
|------|------|------|
| `token.json` | `{userData}/token.json` | access_token, refresh_token, 만료 시간 |

토큰 갱신은 `googleapis` 라이브러리가 자동으로 처리합니다 (refresh_token 기반).

---

## 3. GoogleSync 클래스 설계

### 3.1 클래스 구조

```javascript
class GoogleSync {
    constructor()            // oAuth2Client 초기화
    authorize()              // 인증 처리 (토큰 로드 or 신규 발급)
    getNewTokenAutomatic()   // 로컬 HTTP 서버 기반 토큰 획득
    getCalendars()           // 사용자 캘린더 목록 조회
    listEvents()             // 전체 캘린더 이벤트 조회
    listTasks()              // 전체 Tasks 조회
    addEvent(eventData)      // Google에 이벤트 추가
    updateEvent(id, data)    // Google 이벤트 수정
    deleteEvent(googleId)    // Google 이벤트 삭제
    clearCredentials()       // 인증 정보 삭제 (연동 해제)
}
```

### 3.2 메서드 상세

#### `authorize()`

1. `credentials.json` 로드
2. OAuth2Client 생성
3. `token.json` 존재 확인
   - 있으면 → 토큰 설정 → 만료 시 자동 갱신
   - 없으면 → `getNewTokenAutomatic()` 호출

#### `listEvents()`

- 설정에서 `syncDownloadCalendarIds` 조회
- 각 캘린더별로 `calendar.events.list()` 호출
- `singleEvents: false` — 반복 일정을 시리즈로 가져옴
- 각 이벤트에 `_sourceCalendarId` 부착 (색상 매핑용)

#### `listTasks()`

- 사용자의 모든 Task 목록 조회
- 각 목록별로 Tasks 조회
- 기한(`due`)이 있는 Tasks만 종일 일정으로 변환
- **제목 변환 규칙**:
  - 완료된 Task: `[완료]` 접두사 추가
  - 미완료 Task: `[할일]` 접두사 추가

> **업로드 필터링**: 로컬 일정을 구글로 업로드(`pushToGoogleIfEnabled()`)할 때, 일정 제목이 `[할일]` 또는 `[완료]`로 시작하면 업로드를 건너뜁니다. (Tasks는 구글 Tasks API가 관리하므로 캘린더 이벤트 중복 생성을 방지)

#### `addEvent(eventData)`

- 설정의 `syncUploadCalendarId`에 이벤트 삽입
- RRule 반복 규칙 포함
- 생성된 Google 이벤트 ID 반환 → 로컬 DB에 저장

#### `updateEvent(googleId, eventData)`

- `google_id`로 대상 이벤트를 특정
- 해당하는 캘린더를 찾아서 업데이트

#### `deleteEvent(googleId)`

- `google_id`로 대상 이벤트를 특정
- 해당하는 캘린더에서 삭제

---

## 4. 동기화 로직

### 4.1 다운로드 동기화 (Google → 로컬)

```
Google Events/Tasks 수신
          ↓
각 이벤트에 대해:
  ├─ google_id가 로컬 DB에 존재?
  │    ├─ YES → UPDATE (기존 일정 갱신)
  │    └─ NO  → INSERT (신규 일정 추가)
  └─ 색상 정보: 캘린더 색상 매핑 적용
```

### 4.2 업로드 동기화 (로컬 → Google)

`pushToGoogleIfEnabled()` 헬퍼가 로컬 CRUD 시 자동 호출:

| 로컬 액션 | Google 액션 | 조건 |
|-----------|-------------|------|
| `add-event` | `addEvent()` | 동기화 활성 시 |
| `update-event` | `updateEvent()` | `google_id` 존재 시 |
| `delete-event` | `deleteEvent()` | `google_id` 존재 시 |

### 4.3 연동 해제

1. `clearCredentials()` — `token.json` 삭제
2. `clearGoogleSyncData()` — DB에서 구글 메타데이터 정리
   - 옵션 A: 연동 일정 삭제 (`google_id IS NOT NULL` 행 삭제)
   - 옵션 B: 연동 정보만 초기화 (일정 유지, google_id 등 NULL)

---

## 5. 다중 캘린더 지원

### 5.1 캘린더 설정

| 설정 | 설명 |
|------|------|
| 업로드 캘린더 (1개) | 로컬에서 생성한 일정을 올릴 대상 캘린더 |
| 다운로드 캘린더 (N개) | Google에서 가져올 캘린더 목록 (복수 선택) |

### 5.2 색상 동기화

- 각 캘린더에서 설정된 `backgroundColor`, `foregroundColor` 수신
- 설정 DB에 `syncCalendarColors`, `syncCalendarTextColors`로 매핑 저장
- 이벤트 다운로드 시 해당 캘린더의 색상 자동 적용

---

## 6. 에러 처리

| 에러 상황 | 처리 |
|-----------|------|
| 토큰 만료 | 자동 refresh (googleapis 내장) |
| 토큰 파싱 실패 | token.json 삭제 → 재인증 |
| 네트워크 오류 | `{ status: 'error', message }` 반환 → alert |
| API 호출 실패 | console.error 로깅 + 에러 메시지 반환 |
| 권한 부족 (Scope 변경) | 기존 토큰 삭제 및 재인증 유도 |
| 인증 미완료 | 동기화 건너뛰기 |
| 부분 실패 | 여러 이벤트를 업로드/수정/삭제하는 중 일부 실패가 발생한 경우, 오류 메시지 목록을 수집하여 `{ status: 'partial_error', messages: [...] }` 형태로 반환 후 상세 정보 알림 |
