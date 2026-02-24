# 📅 LuckyDesk (럭키데스크)

LuckyDesk는 바탕화면에서 항상 함께하며 일정을 관리할 수 있는 **심플하고 세련된 데스크탑 캘린더 위젯**입니다. 구글 캘린더와의 강력한 동기화 기능을 통해 어디서든 일정을 관리하세요.

![LuckyDesk Screenshot](https://via.placeholder.com/800x450?text=LuckyDesk+Preview)

## ✨ 핵심 기능

- **바탕화면 위젯**: 투명도 조절이 가능한 글래스모피즘 디자인의 위젯이 바탕화면에 상시 표시됩니다.
- **구글 캘린더 동기화**: 실시간 양방향 동기화를 통해 구글 캘린더 일정을 가져오고, 앱에서 수정한 내용이 구글에 즉시 반영됩니다.
- **다양한 뷰 모드**: 월간(Month), 주간(Week), 일간(Day) 뷰를 지원하며, 0시~24시 타임라인을 한눈에 확인할 수 있습니다.
- **일정 관리**: 반복 일정 설정(매일, 매주, 매월 등), 장소 및 설명 추가, 쾌적한 드래그 앤 드롭 이동을 지원합니다.
- **자동 실행**: 윈도우 시작 시 자동으로 실행되도록 설정하여 매번 켤 필요 없이 편리하게 사용하세요.
- **위젯 커스터마이징**: 위치 및 크기 조절, 자유로운 투명도 설정이 가능합니다.

## 🚀 시작하기

### 설치 방법

1. [Releases](https://github.com/sulucky5/LuckyDesk/releases) 페이지에서 최신 버전의 `Setup.exe`를 다운로드합니다.
2. 다운로드한 파일을 실행하면 자동으로 설치가 완료되고 바탕화면에 바로가기가 생성됩니다.

### 개발용 실행 방법 (Developer)

프로젝트를 직접 빌드하거나 수정하고 싶다면 다음 과정을 따르세요.

```bash
# 저장소 복제
git clone https://github.com/sulucky5/LuckyDesk.git
cd LuckyDesk

# 의존성 설치
npm install

# 앱 실행
npm start

# 배포용 패키지(설치 파일) 생성
npm run make
```

## 🛠 기술 스택

- **Framework**: Electron
- **Database**: SQLite (via better-sqlite3)
- **Library**: FullCalendar v6, RRule, Googleapis
- **Styling**: Vanilla CSS (Modern CSS features)
- **Security**: OAuth 2.0, JS Obfuscation

## 🔒 보안 안내

본 프로젝트는 사용자의 보안을 위해 소스 코드 내의 구글 API 클라이언트 정보 등을 난독화 처리하여 보호하고 있습니다.

## 📝 라이선스

이 프로젝트는 ISC 라이선스를 따릅니다.

---
Developed with ❤️ by LuckyDesk Maker  
📧 Contact: [sulucky5@gmail.com](mailto:sulucky5@gmail.com) | [sulucky5@naver.com](mailto:sulucky5@naver.com)
