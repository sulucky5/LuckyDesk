# LuckyDesk 빌드 및 배포

> 관련 문서: [시스템 아키텍처](./01-architecture.md)

---

## 1. 개요

LuckyDesk는 **Electron Forge** 기반의 빌드/패키징 파이프라인을 사용합니다.

| 항목 | 내용 |
|------|------|
| **빌드 도구** | Electron Forge v7.11.1 |
| **번들러** | Vite v7.3.1 |
| **패키지 형식** | Squirrel (Windows NSIS) |
| **소스 보호** | JavaScript Obfuscation, ASAR |

---

## 2. 빌드 스크립트

### 2.1 NPM Scripts

| 명령어 | 동작 | 용도 |
|--------|------|------|
| `npm start` | credentials 생성 + Electron Forge 시작 | 개발용 실행 |
| `npm run dev` | Vite dev server | 프론트엔드 개발 |
| `npm run build` | credentials 생성 + Vite 빌드 | 프론트엔드 빌드 |
| `npm run package` | credentials 생성 + Forge package | 앱 패키징 (미설치) |
| `npm run make` | credentials 생성 + Forge make | 설치 파일 생성 |
| `npm run dist` | credentials 생성 + electron-builder | 대체 빌드 |
| `npm run pack` | credentials 생성 + electron-builder --dir | 디렉토리 빌드 |

### 2.2 빌드 전처리: credentials 생성

모든 빌드 명령 실행 전 `generate-credentials.js`가 자동 실행됩니다.

```
.env 파일 읽기
  ↓
GOOGLE_CLIENT_ID, PROJECT_ID, CLIENT_SECRET 추출
  ↓
credentials.json 생성
  ↓
빌드 프로세스 시작
```

---

## 3. Electron Forge 설정

### 3.1 패키지 설정 (`forge.config.js`)

```javascript
{
    packagerConfig: {
        asar: true  // 소스를 ASAR 아카이브로 패킹
    }
}
```

### 3.2 Makers (설치 파일 생성기)

| Maker | 플랫폼 | 출력 |
|-------|--------|------|
| `maker-squirrel` | Windows | `.exe` 설치 파일 |
| `maker-zip` | macOS | `.zip` 아카이브 |
| `maker-deb` | Linux (Debian) | `.deb` 패키지 |
| `maker-rpm` | Linux (RedHat) | `.rpm` 패키지 |

> 현재 1차 대상은 Windows입니다.

### 3.3 보안 Fuses

Electron Fuses를 사용하여 배포 빌드의 보안을 강화합니다.

| Fuse | 설정 | 효과 |
|------|------|------|
| `RunAsNode` | `false` | Node.js 모드 실행 방지 |
| `EnableCookieEncryption` | `true` | 쿠키 암호화 |
| `EnableNodeOptionsEnvironmentVariable` | `false` | NODE_OPTIONS 환경변수 무시 |
| `EnableNodeCliInspectArguments` | `false` | 디버깅 인자 비활성화 |
| `EnableEmbeddedAsarIntegrityValidation` | `true` | ASAR 무결성 검증 |
| `OnlyLoadAppFromAsar` | `true` | ASAR에서만 앱 로드 |

---

## 4. electron-builder 설정 (대체)

`package.json`의 `build` 섹션에 electron-builder 설정도 포함되어 있습니다.

```json
{
    "build": {
        "appId": "com.luckydesk.app",
        "productName": "LuckyDesk",
        "win": {
            "target": "nsis"
        },
        "nsis": {
            "oneClick": false,
            "allowToChangeInstallationDirectory": true,
            "createDesktopShortcut": true,
            "createStartMenuShortcut": true
        },
        "directories": {
            "output": "release"
        }
    }
}
```

### NSIS 설정

| 옵션 | 값 | 설명 |
|------|-----|------|
| `oneClick` | `false` | 설치 마법사 표시 (사용자가 옵션 선택 가능) |
| `allowToChangeInstallationDirectory` | `true` | 설치 경로 변경 허용 |
| `createDesktopShortcut` | `true` | 바탕화면 바로가기 생성 |
| `createStartMenuShortcut` | `true` | 시작 메뉴 바로가기 생성 |

---

## 5. 출력 디렉토리

| 빌드 도구 | 출력 경로 | 내용 |
|-----------|----------|------|
| Electron Forge (`make`) | `out/` | 패키지된 앱 + 인스톨러 |
| Electron Forge (`package`) | `out/` | 패키지된 앱 (인스톨러 없이) |
| electron-builder | `release/` | NSIS 인스톨러 |
| Vite (`build`) | `dist/` | 프론트엔드 번들 |

---

## 6. 배포 흐름

### 6.1 릴리스 프로세스

```
1. 코드 변경 완료
   ↓
2. package.json 버전 업데이트
   ↓
3. .env 파일 확인 (Google API 키)
   ↓
4. npm run make (또는 npm run dist)
   ↓
5. 출력 폴더에서 Setup.exe 확인
   ↓
6. GitHub Releases에 업로드
   ↓
7. 사용자가 다운로드 및 설치
```

### 6.2 설치 흐름 (사용자)

```
1. GitHub Releases에서 Setup.exe 다운로드
   ↓
2. Setup.exe 실행
   ↓
3. 설치 경로 선택 (기본: Program Files)
   ↓
4. 설치 완료 → 바탕화면 바로가기 생성
   ↓
5. LuckyDesk 실행
   ↓
6. (선택) 구글 캘린더 연동 설정
```

---

## 7. 개발 환경 설정

### 7.1 필수 사전 요구사항

| 요구사항 | 버전 |
|----------|------|
| Node.js | v18+ 권장 |
| npm | v9+ |
| Python | 3.x (better-sqlite3 네이티브 빌드용) |
| Visual Studio Build Tools | C++ 빌드 도구 (Windows) |

### 7.2 개발 시작

```bash
# 저장소 복제
git clone https://github.com/sulucky5/LuckyDesk.git
cd LuckyDesk

# 의존성 설치
npm install

# .env 설정
cp .env.sample .env
# GOOGLE_CLIENT_ID, CLIENT_SECRET 등 설정

# 개발 실행
npm start
```

### 7.3 .gitignore

```
node_modules/
dist/
out/
release/
.env
credentials.json
```

---

## 8. 의존성 요약

### 8.1 Production Dependencies

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `@fullcalendar/daygrid` | v6.1.20 | 캘린더 그리드 플러그인 |
| `better-sqlite3` | v12.6.2 | SQLite 네이티브 바인딩 |
| `electron-squirrel-startup` | v1.0.1 | Squirrel 설치/업데이트 핸들링 |
| `fullcalendar` | v6.1.20 | 캘린더 코어 |
| `googleapis` | v171.4.0 | Google API 클라이언트 |

### 8.2 Dev Dependencies

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `electron` | v40.6.0 | 프레임워크 |
| `@electron-forge/*` | v7.11.1 | 빌드/패키징 |
| `vite` | v7.3.1 | 번들러 |
| `dotenv` | v17.3.1 | 환경변수 로딩 |
| `javascript-obfuscator` | v5.3.0 | JS 난독화 |
| `electron-rebuild` | v3.2.9 | 네이티브 모듈 리빌드 |
