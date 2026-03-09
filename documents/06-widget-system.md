# LuckyDesk 위젯 시스템 설계

> 관련 문서: [시스템 아키텍처](./01-architecture.md) | [UI/UX 설계](./03-ui-ux-design.md)

---

## 1. 개요

LuckyDesk 위젯 시스템은 Windows 바탕화면 위에서 동작하는 **투명 데스크탑 위젯**을 구현합니다. 핵심 기능으로 클릭 관통(Click-Through), 투명도 조절, 8방향 리사이즈, 위치/크기 기억을 제공합니다.

---

## 2. BrowserWindow 설정

### 2.1 핵심 옵션

```javascript
mainWindow = new BrowserWindow({
    transparent: true,          // 창 배경 투명
    frame: false,               // 기본 타이틀바 제거
    alwaysOnTop: false,         // 일반 윈도우 레벨
    skipTaskbar: true,          // 작업표시줄에서 숨김
    resizable: true,            // 네이티브 리사이즈 활성 (동적 토글)
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
});
```

### 2.2 설정 의도

| 옵션 | 값 | 이유 |
|------|-----|------|
| `transparent` | `true` | 글래스모피즘 효과를 위한 투명 배경 |
| `frame` | `false` | 커스텀 헤더 사용 (네이티브 타이틀바 불필요) |
| `skipTaskbar` | `true` | 위젯은 작업표시줄에 표시 불필요 (트레이로 대체) |
| `resizable` | `true` | 편집 모드 여부에 따라 `set-editable` IPC를 통해 동적으로 `true`/`false` 토글 |

---

## 3. 클릭 관통 (Click-Through) 시스템

### 3.1 동작 원리

위젯의 투명 영역(배경)은 **마우스 이벤트를 통과**시켜 바탕화면 아이콘에 접근할 수 있게 합니다. 캘린더 UI 요소(버튼, 일정 등)는 정상적으로 클릭을 받습니다.

### 3.2 CSS 기반 포인터 이벤트 제어

```css
/* 위젯 배경은 마우스 통과 */
#calendar-widget {
    pointer-events: none;
}

/* UI 요소는 마우스 인식 */
#calendar-widget > *,
.fc-view-harness,
.resizer,
.modal-overlay {
    pointer-events: auto;
}
```

### 3.3 동적 클릭 관통 토글

```javascript
// renderer.js
window.addEventListener('mousemove', (e) => {
    if (isEditMode || isResizing) {
        ipcRenderer.send('set-ignore-mouse', false);
        return;
    }
    
    // 모달 열림 → 클릭 관통 비활성화
    // UI 요소 위 → 클릭 관통 비활성화
    // 빈 영역 → 클릭 관통 활성화
});

// main.js
ipcMain.on('set-ignore-mouse', (event, ignore) => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});
```

### 3.4 상태 매트릭스

| 상태 | 클릭 관통 | 설명 |
|------|----------|------|
| 일반 모드 + 빈 영역 | ✅ ON | 바탕화면 접근 가능 |
| 일반 모드 + UI 요소 위 | ❌ OFF | 캘린더 조작 가능 |
| 편집 모드 | ❌ OFF | 항상 마우스 인식 (이동/리사이즈) |
| 리사이즈 중 | ❌ OFF | 리사이즈 조작 |
| 모달 열림 | ❌ OFF | 모달 입력 |

---

## 4. 투명도 조절

### 4.1 CSS Variable 기반

투명도는 "위젯 전체 배경"과 캘린더 내의 "이벤트 타일" 두 가지로 분리되어 독립적으로 관리됩니다.

```css
:root {
    --bg-opacity: 0.85;     /* 바탕 배경 기본값 */
    --event-opacity: 0.8;   /* 이벤트 기본값 */
    --bg-color: rgba(26, 26, 26, var(--bg-opacity));
}
/* 이벤트 컨테이너에 적용 */
.fc-event {
    opacity: var(--event-opacity);
}
```

### 4.2 사용자 조절

- 설정 모달 내 두 개의 독립된 **투명도 슬라이더** 제공 (배경 투명도 / 이벤트 투명도)
- **배경 투명도 범위**: 0 (불투명) ~ 80 (최대 투명, 표시상 20%~100% 반전)
- **이벤트 투명도 범위**: 0 (불투명) ~ 60 (최대 투명, 표시상 40%~100% 반전)
- 설정 DB에 `opacity` 및 `eventOpacity` 키로 저장
- 앱 재시작 시 복원

---

## 5. 8방향 리사이즈 시스템

### 5.1 리사이즈 핸들 배치

```
 ┌──── [TL] ──────────── [T] ──────────── [TR] ────┐
 │                                                  │
[L]                    위젯 영역                   [R]
 │                                                  │
 └──── [BL] ──────────── [B] ──────────── [BR] ────┘

TL = top-left      T = top        TR = top-right
L  = left                         R  = right
BL = bottom-left   B = bottom     BR = bottom-right
```

### 5.2 HTML 구조

```html
<div class="resizer ns top"></div>
<div class="resizer ns bottom"></div>
<div class="resizer ew left"></div>
<div class="resizer ew right"></div>
<div class="resizer nwse top-left"></div>
<div class="resizer nesw top-right"></div>
<div class="resizer nesw bottom-left"></div>
<div class="resizer nwse bottom-right"></div>
```

### 5.3 리사이즈 로직

```javascript
// 1. mousedown → 리사이즈 시작
resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    mouseStartX = e.screenX;
    mouseStartY = e.screenY;
    winStartW = window.outerWidth;
    winStartH = window.outerHeight;
});

// 2. mousemove → 크기 계산
window.addEventListener('mousemove', (e) => {
    const dx = e.screenX - mouseStartX;
    const dy = e.screenY - mouseStartY;
    
    // 방향에 따라 width, height, x_delta, y_delta 계산
    // 최소 크기 제한: 300px
    
    ipcRenderer.send('set-window-bounds', boundsUpdate);
    calendar.updateSize(); // FullCalendar 크기 동기화
});

// 3. mouseup → 리사이즈 종료
window.addEventListener('mouseup', () => {
    isResizing = false;
});
```

### 5.4 방향별 크기 변경 규칙

| 방향 | Width 변경 | Height 변경 | X 이동 | Y 이동 |
|------|-----------|------------|--------|--------|
| top | - | `startH - dy` | - | `+dy` |
| bottom | - | `startH + dy` | - | - |
| left | `startW - dx` | - | `+dx` | - |
| right | `startW + dx` | - | - | - |
| top-left | `startW - dx` | `startH - dy` | `+dx` | `+dy` |
| top-right | `startW + dx` | `startH - dy` | - | `+dy` |
| bottom-left | `startW - dx` | `startH + dy` | `+dx` | - |
| bottom-right | `startW + dx` | `startH + dy` | - | - |

### 5.5 최소 크기 제한

```javascript
if (newWidth > 300) {
    boundsUpdate.width = newWidth;
}
if (newHeight > 300) {
    boundsUpdate.height = newHeight;
}
```

---

## 6. 편집 모드 (Layout Mode)

### 6.1 토글 동작

```
[📌 버튼 클릭]
  ↓
isEditMode = !isEditMode
  ↓
  ├─ 활성화 시:
  │    ├─ 위젯에 파란 점선 테두리 추가
  │    ├─ 리사이즈 핸들 표시
  │    ├─ 헤더 드래그로 위치 이동 가능
  │    └─ 클릭 관통 비활성화
  │
  └─ 비활성화 시:
       ├─ 테두리/핸들 숨김
       ├─ 현재 위치/크기 저장 (IPC)
       └─ 클릭 관통 복원
```

### 6.2 편집 모드 스타일

```css
#calendar-widget.edit-mode {
    border: 2px dashed var(--accent-blue);
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);
    pointer-events: auto;
}

#calendar-widget.edit-mode .calendar-header {
    cursor: move;
    -webkit-app-region: drag;
}
```

---

## 7. 시스템 트레이

### 7.1 트레이 메뉴

```
┌─────────────┐
│  설정        │ → 설정 모달 열기 + 창 표시
│  종료        │ → app.quit()
└─────────────┘
```

### 7.2 트레이 동작

| 동작 | 결과 |
|------|------|
| 트레이 아이콘 클릭 | 위젯 창 표시 + 포커스 |
| "설정" 메뉴 클릭 | 창 표시 + 설정 모달 열기 |
| "종료" 메뉴 클릭 | 앱 완전 종료 |

### 7.3 트레이 아이콘

- 아이콘 파일: `assets/icon.png`
- 트레이 표시 크기: 16×16px (리사이즈)
- Tooltip: "LuckyDesk"

---

## 8. 위치/크기 영속화

위젯의 위치와 크기는 설정 DB에 저장되어 앱 재시작 시 복원됩니다. 사용자가 편집 모드에서 창 크기나 위치를 변경할 때마다 실시간으로 저장됩니다.

```
앱 시작
  ↓
db.getSettings() → 저장된 위치/크기 읽기 (`bounds`)
  ↓
BrowserWindow.setBounds() → 복원
  ↓
(사용 중 편집 모드에서 리사이즈/이동 발생 시)
  ↓
ipcRenderer.send('set-window-bounds') 호출
  ↓
main.js에서 현재 bounds 실시간 갱신 저장 → db.updateSetting('bounds')
```

---

## 9. 자동 시작 (Auto-Start)

Windows 시작 시 자동 실행되도록 설정할 수 있습니다.

| 항목 | 내용 |
|------|------|
| 설정 위치 | 설정 모달의 "윈도우 시작 시 자동 실행" 체크박스 |
| 구현 방식 | Electron의 `app.setLoginItemSettings()` |
| 저장 | 설정 DB `autoStart` 키 |
