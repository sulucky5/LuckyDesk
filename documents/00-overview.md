# LuckyDesk 시스템 개요

## 1. 프로젝트 정보

| 항목 | 내용 |
|------|------|
| **프로젝트명** | LuckyDesk (럭키데스크) |
| **버전** | v1.0.4 |
| **라이선스** | ISC |
| **개발자** | 김종언 |
| **연락처** | <sulucky5@gmail.com> / <sulucky5@naver.com> |

---

## 2. 프로젝트 소개

LuckyDesk는 Windows 바탕화면에서 항상 함께하며 일정을 관리할 수 있는 **심플하고 세련된 데스크탑 캘린더 위젯** 애플리케이션입니다.

글래스모피즘(Glassmorphism) 디자인을 적용한 반투명 위젯이 바탕화면에 상시 표시되며, 구글 캘린더와의 양방향 동기화를 통해 어디서든 일정을 통합 관리할 수 있습니다.

---

## 3. 핵심 가치

| 가치 | 설명 |
|------|------|
| **Always-On** | 바탕화면에 항상 표시되어 별도의 앱 전환 없이 일정 확인 가능 |
| **Seamless Sync** | 구글 캘린더와의 실시간 양방향 동기화 |
| **Beautiful Design** | 글래스모피즘 기반의 프리미엄 다크 모드 UI |
| **Lightweight** | 최소한의 시스템 리소스로 가볍게 동작 |

---

## 4. 주요 기능 요약

### 4.1 바탕화면 위젯

- 투명도 조절이 가능한 글래스모피즘 디자인
- 클릭 관통(Click-Through) 지원으로 바탕화면 아이콘 접근 가능
- 8방향 리사이즈 핸들
- 드래그를 통한 자유 위치 이동

### 4.2 캘린더 뷰

- **월간(Month) 뷰**: 한 달 전체 일정을 한눈에 조회
- **주간(Week) 뷰**: 0시~24시 타임라인으로 상세 시간 확인
- **일간(Day) 뷰**: 하루 일정을 집중 관리

### 4.3 일정 관리

- 일정 추가/수정/삭제 (CRUD)
- 반복 일정 설정 (매일, 매주, 매월, 매년)
- 반복 일정의 개별 인스턴스 수정/삭제
- 장소 및 설명 추가
- 일정 테마(배경 색상) 및 글자 색상 커스터마이징
- 종일 일정 지원

### 4.4 구글 캘린더 동기화

- OAuth 2.0 기반 안전한 인증
- 양방향 동기화 (로컬 → 구글, 구글 → 로컬)
- 다중 캘린더 다운로드 지원
- Google Tasks 연동
- 캘린더별 색상 동기화

### 4.5 시스템 통합

- Windows 시작 시 자동 실행
- 시스템 트레이 아이콘 (최소화 시 트레이로 이동)
- 설정 모달을 통한 상세 옵션 관리

---

## 5. 기술 스택

| 분류 | 기술 | 버전 | 용도 |
|------|------|------|------|
| **Framework** | Electron | v40.6.0 | 데스크탑 앱 프레임워크 |
| **빌드 도구** | Electron Forge | v7.11.1 | 앱 패키징 및 배포 |
| **번들러** | Vite | v7.3.1 | 프론트엔드 번들링 |
| **Database** | SQLite (better-sqlite3) | v12.6.2 | 로컬 데이터 영속 저장 |
| **캘린더 UI** | FullCalendar | v6.1.20 | 캘린더 렌더링 엔진 |
| **반복 일정** | RRule (FullCalendar plugin) | v6.1.10 | 반복 규칙 처리 |
| **Google API** | googleapis | v171.4.0 | 구글 캘린더/Tasks API 연동 |
| **인증** | OAuth 2.0 | - | 구글 계정 인증 |

> **버전 참고사항**: `package.json` 의존성에는 FullCalendar가 `^6.1.20`으로 지정되어 있으나, 현재 프론트엔드(`index.html`)의 CDN 링크는 `6.1.10` 버전을 호출하고 있습니다. 프로덕션 배포 시점에는 버전을 통일하는 것이 권장됩니다.
| **스타일링** | Vanilla CSS | - | Modern CSS features |
| **보안** | JS Obfuscation | v5.3.0 | 소스 코드 보호 |

---

## 6. 프로젝트 디렉토리 구조

```
LuckyDesk/
├── main.js                 # Electron 메인 프로세스 (엔트리 포인트)
├── index.html              # 애플리케이션 HTML 셸
├── renderer.js             # 렌더러 프로세스 (UI 로직)
├── style.css               # 글로벌 스타일시트
├── db.js                   # SQLite 데이터베이스 추상화 레이어
├── google-sync.js          # 구글 캘린더 동기화 모듈
├── credentials.json        # Google OAuth 자격증명 (자동 생성)
├── forge.config.js         # Electron Forge 빌드 설정
├── package.json            # 프로젝트 메타데이터 및 의존성
├── .env                    # 환경 변수 (Google API 키)
├── .env.sample             # 환경 변수 템플릿
├── assets/
│   └── icon.png            # 앱 아이콘
├── scripts/
│   └── generate-credentials.js  # credentials.json 자동 생성
├── documents/              # 설계 문서
│   ├── 00-overview.md      # 시스템 개요 (본 문서)
│   ├── 01-architecture.md  # 시스템 아키텍처
│   ├── 02-database-design.md   # 데이터베이스 설계
│   ├── 03-ui-ux-design.md  # UI/UX 설계
│   ├── 04-google-sync.md   # 구글 동기화 설계
│   ├── 05-event-management.md  # 일정 관리 설계
│   ├── 06-widget-system.md # 위젯 시스템 설계
│   └── 07-build-deploy.md  # 빌드 및 배포
├── reports/                # 설계/코드 리뷰 및 보고서 (2026-03 추가)
├── dist/                   # Vite 빌드 출력
├── out/                    # Electron Forge 패키지 출력
└── release/                # 배포용 설치 파일
```

---

## 7. 관련 문서

| 문서 | 파일명 | 설명 |
|------|--------|------|
| 시스템 아키텍처 | [01-architecture.md](./01-architecture.md) | 프로세스 구조, IPC 통신, 모듈 설계 |
| 데이터베이스 설계 | [02-database-design.md](./02-database-design.md) | 테이블 스키마, 쿼리 패턴 |
| UI/UX 설계 | [03-ui-ux-design.md](./03-ui-ux-design.md) | 화면 레이아웃, 디자인 시스템 |
| 구글 동기화 | [04-google-sync.md](./04-google-sync.md) | OAuth, API 연동, 동기화 흐름 |
| 일정 관리 | [05-event-management.md](./05-event-management.md) | CRUD, 반복 일정, 비즈니스 로직 |
| 위젯 시스템 | [06-widget-system.md](./06-widget-system.md) | 투명도, 리사이즈, 트레이 |
| 빌드/배포 | [07-build-deploy.md](./07-build-deploy.md) | 패키징, 설치 파일 생성 |

---

## 8. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| v1.0.0 | - | 최초 릴리스: 기본 로컬 캘린더 CRUD 및 데스크탑 위젯 UI 구현 |
| v1.0.4 | 2026-03-05 | 반복 일정 지원(RRule), Google Tasks 동기화, 다중 캘린더 다운로드, 위젯 8방향 리사이즈 핸들 추가 |
