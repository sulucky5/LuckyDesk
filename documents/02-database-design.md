# LuckyDesk 데이터베이스 설계

> 관련 문서: [시스템 아키텍처](./01-architecture.md) | [일정 관리](./05-event-management.md)

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| **DBMS** | SQLite 3 |
| **라이브러리** | better-sqlite3 v12.6.2 |
| **저장 경로** | `{userData}/luckydesk.db` |
| **접근 방식** | 동기식 (Synchronous) |
| **추상화** | `db.js` 모듈 |

---

## 2. 테이블 설계

### 2.1 `events` 테이블

```sql
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    start           TEXT NOT NULL,
    end             TEXT,
    description     TEXT,
    location        TEXT,
    all_day         INTEGER DEFAULT 0,
    google_id       TEXT UNIQUE,
    url             TEXT,
    etag            TEXT,
    status          TEXT,
    color_id        TEXT,
    color           TEXT,
    text_color      TEXT,
    recurrence      TEXT,
    exdates         TEXT,
    recurrence_end  TEXT,
    last_synced     TEXT
);
```

#### 컬럼 상세

| 컬럼 | 타입 | 제약 | 설명 | 예시 |
|------|------|------|------|------|
| `id` | INTEGER | PK, AUTO | 로컬 일정 고유 ID | `1` |
| `title` | TEXT | NOT NULL | 일정 제목 | `"팀 미팅"` |
| `start` | TEXT | NOT NULL | 시작 일시 (ISO 8601) | `"2026-03-05T14:00:00+09:00"` |
| `end` | TEXT | NULLABLE | 종료 일시 | `"2026-03-05T15:00:00+09:00"` |
| `description` | TEXT | NULLABLE | 일정 설명 | `"3층 회의실"` |
| `location` | TEXT | NULLABLE | 장소 | `"서울시 강남구"` |
| `all_day` | INTEGER | DEFAULT 0 | 종일 여부 (0/1) | `0` or `1` |
| `google_id` | TEXT | UNIQUE | Google 이벤트 ID | `"abc123xyz"` |
| `url` | TEXT | NULLABLE | Google 이벤트 URL | `"https://..."` |
| `etag` | TEXT | NULLABLE | Google ETag | `"3456789"` |
| `status` | TEXT | NULLABLE | 이벤트 상태 | `"confirmed"`, `"cancelled"` |
| `color_id` | TEXT | NULLABLE | Google 색상 ID | `"1"` ~ `"11"` |
| `color` | TEXT | NULLABLE | 배경 색상 (HEX) | `"#3B82F6"` |
| `text_color` | TEXT | NULLABLE | 글자 색상 (HEX) | `"#FFFFFF"` |
| `recurrence` | TEXT | NULLABLE | RRule 반복 규칙 | `"RRULE:FREQ=WEEKLY;BYDAY=MO"` |
| `exdates` | TEXT | NULLABLE | 제외 일자 | `"20260305,20260312"` |
| `recurrence_end` | TEXT | NULLABLE | 반복 종료일 | `"2026-12-31"` |
| `last_synced` | TEXT | NULLABLE | 마지막 동기화 시각 | `"2026-03-05T14:00:00Z"` |

#### 컬럼 분류

| 그룹 | 컬럼 |
|------|------|
| 기본 일정 정보 | id, title, start, end, description, location, all_day |
| Google 동기화 | google_id, url, etag, status, last_synced |
| 시각적 표현 | color_id, color, text_color |
| 반복 규칙 | recurrence, exdates, recurrence_end |

### 2.2 `settings` 테이블

```sql
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
```

| Key | 설명 | 값 예시 |
|-----|------|---------|
| `enableSync` | 구글 동기화 활성화 여부 | `"true"` / `"false"` |
| `syncUploadCalendarId` | 업로드 대상 캘린더 | `"primary"` |
| `syncDownloadCalendarIds` | 다운로드 캘린더 목록 (JSON) | `'["cal1","cal2"]'` |
| `syncCalendarColors` | 캘린더 색상 매핑 (JSON) | `'{"cal1":"#3B82F6"}'` |
| `syncCalendarTextColors` | 캘린더 글자색 매핑 (JSON) | `'{"cal1":"#FFFFFF"}'` |
| `opacity` | 위젯 배경 투명도 | `"0.85"` |
| `eventOpacity` | 이벤트 투명도 (배경과 독립) | `"0.8"` |
| `autoStart` | Windows 시작 시 자동 실행 | `"true"` / `"false"` |
| `bounds` | 위젯 위치/크기 (JSON) | `'{"x":100,"y":200,"width":600,"height":400}'` |

---

## 3. 주요 쿼리 패턴

### 3.1 범위 내 일정 조회

```sql
SELECT * FROM events 
WHERE (status IS NULL OR status != 'cancelled')
AND (
    (recurrence IS NULL AND start < :endDate AND (end IS NULL OR end > :startDate))
    OR 
    (recurrence IS NOT NULL AND start < :endDate 
     AND (recurrence_end IS NULL OR recurrence_end >= :startDate))
)
```

> 반복 일정은 DB에 원본 1건만 저장, 렌더러에서 RRule로 인스턴스 전개

### 3.2 CRUD 쿼리

- **INSERT**: 17개 컬럼 삽입, `lastInsertRowid` 반환
- **UPDATE**: id 기준 전체 컬럼 갱신
- **DELETE**: `DELETE FROM events WHERE id = ?`
- **설정 UPSERT**: `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`

---

## 4. 스키마 마이그레이션

**점진적 컬럼 추가(Additive Migration)** 전략을 사용합니다.

```javascript
const addColumn = (name, type) => {
    try {
        db.prepare(`ALTER TABLE events ADD COLUMN ${name} ${type}`).run();
    } catch (e) { /* 이미 존재 시 무시 */ }
};
```

앱 시작 시 `CREATE TABLE IF NOT EXISTS` 실행 후 모든 `addColumn()` 호출을 순차 실행합니다.

---

## 5. 데이터 무결성 및 백업

| 항목 | 내용 |
|------|------|
| 제약 조건 | PK(id), NOT NULL(title, start), UNIQUE(google_id) |
| 취소 일정 | `status = 'cancelled'`로 소프트 삭제 |
| 백업 | DB 파일 직접 복사 |
| 초기화 | `resetApp()` — DELETE + VACUUM |
| 연동 해제 | `clearGoogleSyncData()` — 구글 메타데이터만 정리 |
