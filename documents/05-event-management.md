# LuckyDesk 일정 관리 설계

> 관련 문서: [데이터베이스 설계](./02-database-design.md) | [UI/UX 설계](./03-ui-ux-design.md) | [구글 동기화](./04-google-sync.md)

---

## 1. 개요

LuckyDesk의 일정 관리는 **로컬 우선(Local-First)** 방식을 채택합니다. 모든 일정은 로컬 SQLite에 먼저 저장되며, 구글 동기화 활성 시 백그라운드로 Google API에 반영됩니다.

---

## 2. 일정 데이터 모델

### 2.1 EventData 구조

```javascript
{
    id: number,              // 로컬 DB ID (수정/삭제 시 필수)
    title: string,           // 일정 제목 (필수)
    start: string,           // 시작 일시 (ISO 8601, 필수)
    end: string | null,      // 종료 일시
    description: string,     // 설명
    location: string,        // 장소
    all_day: boolean,        // 종일 일정 여부
    google_id: string,       // Google 이벤트 ID
    url: string,             // Google 이벤트 URL
    etag: string,            // Google ETag
    status: string,          // 상태 (confirmed/cancelled)
    color_id: string,        // Google 색상 ID
    color: string,           // 배경 색상 (HEX)
    text_color: string,      // 글자 색상 (HEX)
    recurrence: string,      // RRule 규칙
    exdates: string,         // 제외 일자 (콤마 구분)
    recurrence_end: string   // 반복 종료일
}
```

---

## 3. CRUD 흐름

### 3.1 일정 추가

```
날짜 더블클릭 → openModal(dateStr) → 폼 입력 → [저장]
  ↓
renderer.js: ipcRenderer.invoke('add-event', data)
  ↓
main.js: db.addEvent(data) → newId
  ↓
main.js: pushToGoogleIfEnabled('add', data, newId)
  ↓
(Google 동기화 활성 시) googleSync.addEvent() → google_id
  ↓
db.updateGoogleId(newId, google_id)
  ↓
window.location.reload() // 전체 페이지 새로고침으로 UI 갱신
```

> **비고**: 동기화 성공, 일정 추가/수정/삭제 후에는 일관된 상태 유지를 위해 `window.location.reload()`를 호출하여 전체 캘린더 데이터를 다시 렌더링합니다.

### 3.2 일정 수정

```
이벤트 더블클릭 → openModal(dateStr, event) → 폼 수정 → [저장]
  ↓
renderer.js: ipcRenderer.invoke('update-event', data)
  ↓
main.js: db.updateEvent(data)
  ↓
(google_id 존재 시) pushToGoogleIfEnabled('update', data)
  ↓
calendar.refetchEvents()
```

### 3.3 일정 삭제

```
이벤트 더블클릭 → openModal → [삭제]
  ↓
renderer.js: ipcRenderer.invoke('delete-event', id)
  ↓
main.js: db.getEventById(id) → eventData
  ↓
main.js: db.deleteEvent(id)
  ↓
(google_id 존재 시) pushToGoogleIfEnabled('delete', eventData)
  ↓
calendar.refetchEvents()
```

---

## 4. 반복 일정 시스템

### 4.1 RRule 지원 범위

| 주기 | FREQ 값 | 세부 옵션 |
|------|---------|-----------|
| 매일 | `DAILY` | INTERVAL |
| 매주 | `WEEKLY` | INTERVAL, BYDAY (요일 선택) |
| 매월 | `MONTHLY` | INTERVAL, BYMONTHDAY (일자) 또는 BYDAY+BYSETPOS (n번째 요일) |
| 매년 | `YEARLY` | INTERVAL |

### 4.2 반복 종료 조건

| 종류 | RRule 파라미터 | 설명 |
|------|---------------|------|
| 무한 반복 | `UNTIL=99991231T235959Z` | 실제로는 먼 미래 날짜를 종료일로 설정하여 무한을 에뮬레이트 |
| 날짜 지정 | `UNTIL=YYYYMMDD` | 특정 날짜까지 반복 |
| 횟수 지정 | `COUNT=N` | N회 반복 후 종료 |

### 4.3 반복 규칙 예시

```
# 매주 월,수,금 반복
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR

# 매월 15일 반복, 2026년 12월까지
RRULE:FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20261231

# 매월 두 번째 화요일, 10회
RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2;COUNT=10

# 격주 반복
RRULE:FREQ=WEEKLY;INTERVAL=2
```

### 4.4 반복 인스턴스 전개 (`expandRecurringEvent`)

DB에는 반복 일정의 **원본 1건**만 저장합니다. FullCalendar의 `events` 콜백에서 렌더러가 RRule을 파싱하여 뷰 범위 내의 인스턴스를 생성합니다.

```
DB에서 반복 일정 조회
  ↓
expandRecurringEvent(event, rangeStart, rangeEnd)
  ↓
RRule 문자열 파싱 → rrule.js 인스턴스 생성
  ↓
rangeStart ~ rangeEnd 범위의 날짜 생성
  ↓
exdates 필터링 (제외 일자 제거)
  ↓
각 인스턴스에 대해 FullCalendar 이벤트 객체 생성
  ├── id: "recurring-{dbId}-{yyyymmdd}"
  ├── start/end: 인스턴스 날짜에 맞춰 조정
  └── extendedProps: { db_id, db_start, recurrence, exdates, ... }
```

### 4.5 반복 일정 수정 유형

반복 일정의 개별 인스턴스를 수정할 때 3가지 옵션을 제공합니다:

#### (1) "이 일정만 수정" (Single Instance)

```
1. 원본 시리즈의 exdates에 해당 날짜 추가
   → 이 인스턴스를 시리즈에서 제외
2. 수정된 내용으로 새로운 단일 일정 INSERT
   → 독립적인 일정으로 분리
```

#### (2) "이 일정 및 향후 일정 수정" (This and Following)

```
1. 원본 시리즈의 UNTIL을 수정 인스턴스 전날로 설정
   → 원본 시리즈를 이 날짜 이전까지만 유효하게 변경
2. 수정된 내용으로 새로운 반복 시리즈 INSERT
   → 수정 날짜부터 시작하는 새 반복 일정 생성
```

#### (3) "모든 일정 수정" (All)

```
원본 시리즈의 모든 속성을 직접 UPDATE
→ 전체 시리즈에 변경 사항 반영
```

### 4.6 반복 일정 삭제 유형

| 삭제 유형 | 동작 |
|-----------|------|
| 이 일정만 | exdates에 해당 날짜 추가 |
| 이 일정 및 향후 | UNTIL을 전날로 변경 |
| 모든 일정 | 시리즈 원본 DELETE |

---

## 5. 종일 일정 처리

| 항목 | 시간 지정 일정 | 종일 일정 |
|------|---------------|-----------|
| `all_day` | `0` | `1` |
| `start` 형식 | `2026-03-05T14:00:00` | `2026-03-05` |
| `end` 형식 | `2026-03-05T15:00:00` | `2026-03-06` (다음 날) |
| 입력 필드 | `datetime-local` | `date` |
| FullCalendar | `allDay: false` | `allDay: true` |

---

## 6. 색상 시스템

### 6.1 프리셋 배경 색상

| 색상 | HEX | 용도 |
|------|-----|------|
| 블루 | `#3B82F6` | 기본/업무 |
| 레드 | `#EF4444` | 중요/긴급 |
| 에메랄드 | `#10B981` | 자연/완료 |
| 앰버 | `#F59E0B` | 주의/개인 |

### 6.2 프리셋 글자 색상

| 색상 | HEX |
|------|-----|
| 흰색 | `#FFFFFF` |
| 검정 | `#000000` |

모든 이벤트에 대해 프리셋 색상 외에도 커스텀 색상 매핑(conic-gradient 색상 선택기)을 완벽하게 지원합니다.

---

## 7. 뷰 날짜 기억

마지막으로 본 날짜를 `localStorage`에 저장하여 앱 재시작 시 복원합니다.

```javascript
// 저장
localStorage.setItem('calendarInitialDate', dateStr);

// 복원
let initialDate = localStorage.getItem('calendarInitialDate');
```
