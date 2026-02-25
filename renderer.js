const { ipcRenderer } = require('electron');

let calendar;
let currentEvent = null;

document.addEventListener('DOMContentLoaded', async () => {
    const calendarEl = document.getElementById('calendar');
    const monthDisplay = document.getElementById('month-display');
    const widget = document.getElementById('calendar-widget');
    const layoutBtn = document.getElementById('layout-btn');
    const modal = document.getElementById('event-modal');
    const eventInput = document.getElementById('event-input');
    const eventLocation = document.getElementById('event-location');
    const eventDesc = document.getElementById('event-desc');
    const eventAllDay = document.getElementById('event-allday');
    const eventStart = document.getElementById('event-start');
    const eventEnd = document.getElementById('event-end');
    const bgColors = document.querySelectorAll('#bg-color-options .color-circle');
    const textColors = document.querySelectorAll('#text-color-options .color-circle');
    const googleLinkBtn = document.getElementById('open-google-link');
    const recurringChoice = document.getElementById('recurring-choice');
    const editTypeInputs = document.getElementsByName('edit-type');

    // 반복 일정 관련 DOM
    const eventRepeat = document.getElementById('event-repeat');
    const recurrenceOptions = document.getElementById('recurrence-options');
    const repeatFreq = document.getElementById('repeat-freq');
    const repeatInterval = document.getElementById('repeat-interval');
    const intervalUnit = document.getElementById('interval-unit');
    const weeklyOptions = document.getElementById('weekly-options');
    const monthlyOptions = document.getElementById('monthly-options');
    const repeatDomText = document.getElementById('repeat-dom-text');
    const repeatDowText = document.getElementById('repeat-dow-text');
    const repeatEndType = document.getElementById('repeat-end-type');
    const endDateOption = document.getElementById('end-date-option');
    const repeatEndDate = document.getElementById('repeat-end-date');
    const endCountOption = document.getElementById('end-count-option');
    const repeatEndCount = document.getElementById('repeat-end-count');

    let isEditMode = false;
    let isResizing = false;

    // 앱 시작 시 이벤트 로드 (초기 로드는 FullCalendar가 처리하도록 함)
    console.log('App started. Calendar will load events dynamically.');

    console.log('FullCalendar check:', typeof FullCalendar, FullCalendar ? FullCalendar.version : 'null');

    let lastDateClickTime = 0;
    let lastDateClicked = null;
    let lastEventClickTime = 0;
    let lastEventClickedId = null;

    // 날짜를 YYYY-MM-DD 문자열로 변환
    function toDateKey(d) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${da}`;
    }

    // exdates 문자열을 YYYY-MM-DD Set으로 파싱
    function parseExdateSet(exdatesStr) {
        if (!exdatesStr) return new Set();
        return new Set(
            exdatesStr.split(',')
                .map(d => d.trim())
                .filter(d => d.length > 0)
                .map(d => {
                    // yyyyMMdd -> YYYY-MM-DD
                    const digits = d.replace(/[-T:]/g, '').substring(0, 8);
                    if (/^\d{8}$/.test(digits)) {
                        return `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`;
                    }
                    return d.substring(0, 10); // YYYY-MM-DD 부분만
                })
        );
    }

    // RRule 문자열 + dtstart로 인스턴스 생성
    function expandRecurringEvent(e, rangeStart, rangeEnd) {
        try {
            if (!e || !e.start || !e.recurrence) return [];
            if (e.status === 'cancelled') return [];

            const isAllDay = e.all_day === 1;

            // dtstart 파싱
            const startStr = e.start;
            let dtstart;
            if (startStr.includes('T')) {
                const parts = startStr.replace('Z', '').split('T');
                const dp = parts[0].split('-').map(Number);
                const tp = (parts[1] || '00:00:00').split(':').map(Number);
                dtstart = new Date(dp[0], dp[1] - 1, dp[2], tp[0] || 0, tp[1] || 0, tp[2] || 0);
            } else if (/^\d{8}$/.test(startStr)) {
                dtstart = new Date(+startStr.substring(0, 4), +startStr.substring(4, 6) - 1, +startStr.substring(6, 8));
            } else {
                const dp = startStr.split('-').map(Number);
                dtstart = new Date(dp[0], dp[1] - 1, dp[2] || 1);
            }
            if (isNaN(dtstart.getTime())) return [];

            // duration 계산
            let durationMs = 0;
            if (e.end) {
                const endStr = e.end;
                let dtend;
                if (endStr.includes('T')) {
                    const parts = endStr.replace('Z', '').split('T');
                    const dp = parts[0].split('-').map(Number);
                    const tp = (parts[1] || '00:00:00').split(':').map(Number);
                    dtend = new Date(dp[0], dp[1] - 1, dp[2], tp[0] || 0, tp[1] || 0, tp[2] || 0);
                } else {
                    const dp = endStr.split('-').map(Number);
                    dtend = new Date(dp[0], dp[1] - 1, dp[2] || 1);
                }
                if (!isNaN(dtend.getTime())) {
                    durationMs = dtend.getTime() - dtstart.getTime();
                }
            }
            if (durationMs <= 0 && !isAllDay) durationMs = 60 * 60 * 1000; // 기본 1시간
            if (durationMs <= 0 && isAllDay) durationMs = 24 * 60 * 60 * 1000; // 기본 1일

            // RRule 파싱
            let rruleStr = e.recurrence;
            if (!rruleStr.startsWith('RRULE:') && !rruleStr.startsWith('DTSTART')) {
                rruleStr = 'RRULE:' + rruleStr;
            }

            // DTSTART가 없으면 추가
            if (!rruleStr.includes('DTSTART')) {
                const pad = (n) => String(n).padStart(2, '0');
                const dtstartRRule = `${dtstart.getFullYear()}${pad(dtstart.getMonth() + 1)}${pad(dtstart.getDate())}T${pad(dtstart.getHours())}${pad(dtstart.getMinutes())}${pad(dtstart.getSeconds())}`;
                rruleStr = `DTSTART:${dtstartRRule}\n${rruleStr}`;
            }

            const rule = rrule.RRule.fromString(rruleStr);

            // 범위 내 인스턴스 생성
            const instances = rule.between(
                new Date(rangeStart.getTime() - durationMs), // 범위 약간 앞쪽도 포함
                rangeEnd,
                true
            );

            // exdates Set 생성
            const exdateSet = parseExdateSet(e.exdates);

            // 각 인스턴스를 개별 이벤트로 변환
            const events = [];
            for (const instanceDate of instances) {
                const dateKey = toDateKey(instanceDate);

                // exdates에 해당하는 날짜면 건너뜀
                if (exdateSet.has(dateKey)) continue;

                const instanceEnd = new Date(instanceDate.getTime() + durationMs);

                const eventObj = {
                    id: `${e.id}_${dateKey}`,
                    title: e.title,
                    allDay: isAllDay,
                    start: instanceDate,
                    end: instanceEnd,
                    extendedProps: {
                        google_id: e.google_id,
                        url: e.url,
                        etag: e.etag,
                        status: e.status,
                        color_id: e.color_id,
                        color: e.color,
                        text_color: e.text_color,
                        recurrence: e.recurrence,
                        exdates: e.exdates,
                        db_start: e.start,
                        db_end: e.end,
                        description: e.description,
                        location: e.location,
                        originalId: e.id // 원본 DB id
                    },
                    backgroundColor: e.color || '#3B82F6',
                    borderColor: e.color || '#3B82F6',
                    textColor: e.text_color || '#FFFFFF'
                };
                events.push(eventObj);
            }
            return events;
        } catch (err) {
            console.error('Error expanding recurring event:', err, e);
            return [];
        }
    }

    // 단일(비반복) 이벤트 포맷
    function formatSingleEvent(e) {
        try {
            if (!e || !e.start) return null;
            if (e.status === 'cancelled') return null;

            return {
                id: e.id,
                title: e.title,
                start: e.start,
                end: e.end,
                allDay: e.all_day === 1,
                extendedProps: {
                    google_id: e.google_id,
                    url: e.url,
                    etag: e.etag,
                    status: e.status,
                    color_id: e.color_id,
                    color: e.color,
                    text_color: e.text_color,
                    recurrence: e.recurrence,
                    exdates: e.exdates,
                    db_start: e.start,
                    db_end: e.end,
                    description: e.description,
                    location: e.location
                },
                backgroundColor: e.color || '#3B82F6',
                borderColor: e.color || '#3B82F6',
                textColor: e.text_color || '#FFFFFF'
            };
        } catch (err) {
            console.error('Error formatting event:', err, e);
            return null;
        }
    }

    try {
        if (!calendarEl) return;

        let initialDate = localStorage.getItem('calendarInitialDate');
        if (initialDate) {
            const check = new Date(initialDate);
            if (isNaN(check.getTime())) initialDate = undefined;
        }

        calendar = new FullCalendar.Calendar(calendarEl, {
            initialDate: initialDate || undefined,
            initialView: 'dayGridMonth',
            slotMinTime: '00:00:00',
            slotMaxTime: '24:00:00',
            slotDuration: '01:00:00', // 1시간 단위
            snapDuration: '00:15:00', // 이동은 15분 단위
            expandRows: true, // 한 화면에 꽉 차게 조절
            nowIndicator: true,
            headerToolbar: false,
            height: '100%',
            locale: 'ko',
            firstDay: 0,
            dayCellContent: function (info) {
                return info.dayNumberText.replace('일', '');
            },
            events: function (info) {
                const rangeStart = info.start;
                const rangeEnd = info.end;
                return ipcRenderer.invoke('get-events', {
                    start: info.startStr,
                    end: info.endStr
                }).then(rawEvents => {
                    const allEvents = [];
                    for (const e of rawEvents) {
                        if (e.recurrence) {
                            // 반복 일정: RRule로 직접 펼치고 exdates 필터링
                            const expanded = expandRecurringEvent(e, rangeStart, rangeEnd);
                            allEvents.push(...expanded);
                        } else {
                            // 단일 일정
                            const formatted = formatSingleEvent(e);
                            if (formatted) allEvents.push(formatted);
                        }
                    }
                    return allEvents;
                }).catch(err => {
                    console.error('Events load error:', err);
                    return [];
                });
            },
            dateClick: function (info) {
                if (isEditMode) return;
                const isNumber = info.jsEvent.target.closest('.fc-daygrid-day-number');
                if (!isNumber) return;

                const now = Date.now();
                if (lastDateClicked === info.dateStr && (now - lastDateClickTime) < 300) {
                    openModal(info.dateStr);
                }
                lastDateClickTime = now;
                lastDateClicked = info.dateStr;
            },
            eventClick: function (info) {
                if (isEditMode) return;
                const now = Date.now();
                if (lastEventClickedId === info.event.id && (now - lastEventClickTime) < 300) {
                    openModal(null, info.event);
                }
                lastEventClickTime = now;
                lastEventClickedId = info.event.id;
            },
            datesSet: function (dateInfo) {
                if (monthDisplay) monthDisplay.innerText = dateInfo.view.title;
                if (dateInfo.start) {
                    localStorage.setItem('calendarInitialDate', dateInfo.start.toISOString());
                }
            }
        });

        calendar.render();
    } catch (error) {
        console.error('Main init error:', error);
    }

    document.getElementById('prev-btn').addEventListener('click', () => { if (calendar) calendar.prev(); });
    document.getElementById('next-btn').addEventListener('click', () => { if (calendar) calendar.next(); });

    // 보기 모드 전환
    const viewBtns = document.querySelectorAll('.view-btn');
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewType = btn.id === 'view-month' ? 'dayGridMonth' : (btn.id === 'view-week' ? 'timeGridWeek' : 'timeGridDay');
            if (calendar) {
                calendar.changeView(viewType);
                calendar.today(); // 뷰 변경 시 오늘 날짜로 이동
                viewBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });

    // 레이아웃 모드
    layoutBtn.addEventListener('click', () => {
        isEditMode = !isEditMode;
        if (isEditMode) {
            layoutBtn.classList.add('active');
            widget.classList.add('edit-mode');
            ipcRenderer.send('set-ignore-mouse', false);
            ipcRenderer.send('set-editable', true);
        } else {
            layoutBtn.classList.remove('active');
            widget.classList.remove('edit-mode');
            ipcRenderer.send('set-editable', false);

            const rect = widget.getBoundingClientRect();
            ipcRenderer.send('set-window-bounds', {
                width: Math.ceil(rect.width) + 20,
                height: Math.ceil(rect.height) + 20
            });
        }
    });

    // 마우스 이동 시 투명 영역 체크하여 클릭 관통 여부 결정
    window.addEventListener('mousemove', (e) => {
        if (isEditMode || isResizing) {
            ipcRenderer.send('set-ignore-mouse', false);
            return;
        }

        // 모달이 열려 있는지 확인
        const isModalOpen = modal && modal.style.display === 'flex';

        // 실제 콘텐츠(헤더, 버튼, 일정, 날짜 숫자 등)가 있는 요소인지 확인
        // .fc-scrollgrid-sync-inner 처럼 광범위한 클래스는 제외하여 빈 영역은 관통 가능하게 함
        const isInteractive = e.target.closest('.calendar-header, .icon-btn, .fc-event, .fc-daygrid-day-number, .modal-content, #settings-modal .modal-content');

        if (isInteractive || isModalOpen) {
            ipcRenderer.send('set-ignore-mouse', false);
        } else {
            // 배경이나 빈 공간일 경우 마우스 이벤트 무시 (바탕화면 아이콘 클릭 가능)
            ipcRenderer.send('set-ignore-mouse', true, { forward: true });
        }
    });

    // 초기 상태: 마우스 통과 설정 (위젯 특성)
    ipcRenderer.send('set-ignore-mouse', true, { forward: true });

    // 8방향 리사이즈 (윈도우 경계 동기화 방식)
    const resizers = document.querySelectorAll('.resizer');
    let currentResizer = null;
    let mouseStartX, mouseStartY;
    let winStartW, winStartH;

    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            currentResizer = resizer;
            mouseStartX = e.screenX;
            mouseStartY = e.screenY;

            // 드래그 시작 시점의 전체 윈도우 크기 저장
            winStartW = window.outerWidth;
            winStartH = window.outerHeight;

            e.preventDefault();
            e.stopPropagation();
        });
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentResizer) return;

        const dx = e.screenX - mouseStartX;
        const dy = e.screenY - mouseStartY;

        const classes = currentResizer.classList;
        let newWidth = winStartW;
        let newHeight = winStartH;
        let deltaX = 0;
        let deltaY = 0;

        // 방향별 크기 변화 및 위치 이동량(delta) 계산
        if (classes.contains('right')) {
            newWidth = winStartW + dx;
        } else if (classes.contains('left')) {
            newWidth = winStartW - dx;
            deltaX = dx;
        }

        if (classes.contains('bottom')) {
            newHeight = winStartH + dy;
        } else if (classes.contains('top')) {
            newHeight = winStartH - dy;
            deltaY = dy;
        }

        // 대각선 통합 처리
        if (classes.contains('bottom-right')) {
            newWidth = winStartW + dx;
            newHeight = winStartH + dy;
        } else if (classes.contains('top-right')) {
            newWidth = winStartW + dx;
            newHeight = winStartH - dy;
            deltaY = dy;
        } else if (classes.contains('bottom-left')) {
            newWidth = winStartW - dx;
            newHeight = winStartH + dy;
            deltaX = dx;
        } else if (classes.contains('top-left')) {
            newWidth = winStartW - dx;
            newHeight = winStartH - dy;
            deltaX = dx;
            deltaY = dy;
        }

        let boundsUpdate = {};
        if (newWidth > 300) {
            boundsUpdate.width = newWidth;
            if (deltaX !== 0) {
                boundsUpdate.x_delta = deltaX;
                mouseStartX = e.screenX;
                winStartW = newWidth;
            }
        }
        if (newHeight > 300) {
            boundsUpdate.height = newHeight;
            if (deltaY !== 0) {
                boundsUpdate.y_delta = deltaY;
                mouseStartY = e.screenY;
                winStartH = newHeight;
            }
        }

        // Electron 창 크기 및 위치 실시간 연동
        if (Object.keys(boundsUpdate).length > 0) {
            ipcRenderer.send('set-window-bounds', boundsUpdate);
        }

        // FullCalendar 크기 갱신
        if (calendar) calendar.updateSize();
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            currentResizer = null;
        }
    });

    // 반복 설정 UI 제어
    eventRepeat.addEventListener('change', () => {
        recurrenceOptions.classList.toggle('hidden', !eventRepeat.checked);
        if (eventRepeat.checked) updateRecurrenceUI();
    });

    repeatFreq.addEventListener('change', updateRecurrenceUI);
    repeatEndType.addEventListener('change', updateRecurrenceUI);

    function updateRecurrenceUI() {
        const freq = repeatFreq.value;
        const units = { 'DAILY': '일', 'WEEKLY': '주', 'MONTHLY': '월', 'YEARLY': '년' };
        intervalUnit.innerText = `${units[freq]} 마다`;

        weeklyOptions.classList.toggle('hidden', freq !== 'WEEKLY');
        monthlyOptions.classList.toggle('hidden', freq !== 'MONTHLY');

        const endType = repeatEndType.value;
        endDateOption.classList.toggle('hidden', endType !== 'DATE');
        endCountOption.classList.toggle('hidden', endType !== 'COUNT');

        // 월간 반복 텍스트 업데이트
        if (freq === 'MONTHLY' && currentEvent) {
            const date = new Date(currentEvent.start || currentEvent.startStr);
            const dom = date.getDate();
            const weekNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
            const dow = weekNames[date.getDay()];
            const nth = Math.ceil(dom / 7);

            repeatDomText.innerText = `매월 ${dom}일`;
            repeatDowText.innerText = `매월 ${nth}번째 ${dow}`;
        }
    }

    // 반복규칙에서 종료일(UNTIL)을 ISO 날짜 문자열로 추출
    function extractRecurrenceEnd(recurrenceRule) {
        if (!recurrenceRule) return null;
        const parts = recurrenceRule.split(';');
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('UNTIL=')) {
                const untilVal = trimmed.substring(6); // e.g. 99991231T235959Z or 20261231T235959Z
                const digits = untilVal.replace(/[^0-9]/g, '').substring(0, 8);
                if (digits.length === 8) {
                    return `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`;
                }
            }
        }
        return null; // UNTIL이 없으면 null
    }

    function getRecurrenceRule() {
        if (!eventRepeat.checked) return null;

        let rule = `FREQ=${repeatFreq.value};INTERVAL=${repeatInterval.value}`;

        if (repeatFreq.value === 'WEEKLY') {
            const days = Array.from(weeklyOptions.querySelectorAll('input:checked')).map(i => i.value);
            if (days.length > 0) rule += `;BYDAY=${days.join(',')}`;
        } else if (repeatFreq.value === 'MONTHLY') {
            const type = document.querySelector('input[name="monthly-type"]:checked').value;
            // 입력된 시작 날짜를 기준으로 월간 반복 계산
            const date = new Date(eventStart.value);
            if (type === 'DOM') {
                rule += `;BYMONTHDAY=${date.getDate()}`;
            } else {
                const dayKeys = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
                const nth = Math.ceil(date.getDate() / 7);
                rule += `;BYDAY=${nth}${dayKeys[date.getDay()]}`;
            }
        }

        if (repeatEndType.value === 'DATE' && repeatEndDate.value) {
            rule += `;UNTIL=${repeatEndDate.value.replace(/-/g, '')}T235959Z`;
        } else if (repeatEndType.value === 'COUNT') {
            rule += `;COUNT=${repeatEndCount.value}`;
        } else {
            // 계속 반복(NEVER): 9999년 12월 31일을 종료일로 설정
            rule += `;UNTIL=99991231T235959Z`;
        }

        return rule;
    }

    function parseRecurrenceRule(rule) {
        if (!rule) {
            eventRepeat.checked = false;
            recurrenceOptions.classList.add('hidden');
            return;
        }

        eventRepeat.checked = true;
        recurrenceOptions.classList.remove('hidden');

        const parts = rule.split(';');
        parts.forEach(part => {
            const [key, value] = part.split('=');
            if (key === 'FREQ') repeatFreq.value = value;
            if (key === 'INTERVAL') repeatInterval.value = value;
            if (key === 'COUNT') {
                repeatEndType.value = 'COUNT';
                repeatEndCount.value = value;
            }
            if (key === 'UNTIL') {
                repeatEndType.value = 'DATE';
                const dateStr = value.substring(0, 8);
                repeatEndDate.value = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
            }
            if (key === 'BYDAY' && repeatFreq.value === 'WEEKLY') {
                const days = value.split(',');
                weeklyOptions.querySelectorAll('input').forEach(i => i.checked = days.includes(i.value));
            }
            if (repeatFreq.value === 'MONTHLY') {
                if (key === 'BYMONTHDAY') {
                    document.querySelector('input[name="monthly-type"][value="DOM"]').checked = true;
                } else if (key === 'BYDAY') {
                    document.querySelector('input[name="monthly-type"][value="DOW"]').checked = true;
                }
            }
        });

        if (!rule.includes('COUNT') && !rule.includes('UNTIL')) {
            repeatEndType.value = 'NEVER';
        }

        updateRecurrenceUI();
    }

    // 구글 동기화
    document.getElementById('sync-btn').addEventListener('click', async () => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.style.display = 'flex';

        try {
            const result = await ipcRenderer.invoke('sync-google');
            if (loadingOverlay) loadingOverlay.style.display = 'none';

            if (result && result.status === 'success') {
                location.reload(); // 데이터 갱신을 위해 새로고침
            } else {
                alert(`동기화 실패: ${result ? result.message : '알 수 없는 오류'}`);
            }
        } catch (e) {
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            alert(`동기화 중 오류 발생: ${e.message}`);
        }
    });

    // 닫기
    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.send('close-app');
    });

    function formatDateTimeLocal(date) {
        if (!date) return '';
        const d = (typeof date === 'string') ? new Date(date) : date;
        if (isNaN(d.getTime())) return '';
        const pad = (n) => n.toString().padStart(2, '0');
        const hours = isNaN(d.getHours()) ? 9 : d.getHours();
        const minutes = isNaN(d.getMinutes()) ? 0 : d.getMinutes();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hours)}:${pad(minutes)}`;
    }

    function formatDateOnly(date) {
        if (!date) return '';
        const d = (typeof date === 'string') ? new Date(date) : date;
        if (isNaN(d.getTime())) return '';
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function updateDateTimeInputs(allDay, start, end) {
        if (allDay) {
            eventStart.type = 'date';
            eventEnd.type = 'date';
            eventStart.value = formatDateOnly(start);
            eventEnd.value = formatDateOnly(end || start);
        } else {
            eventStart.type = 'datetime-local';
            eventEnd.type = 'datetime-local';
            eventStart.value = formatDateTimeLocal(start);
            // 만약 시작일만 있고 종료일이 없거나 시작일과 같으면 기본 1시간 후로 설정
            if (!end || end === start) {
                const sDate = new Date(start);
                if (!isNaN(sDate.getTime())) {
                    const eDate = new Date(sDate.getTime() + 60 * 60 * 1000);
                    eventEnd.value = formatDateTimeLocal(eDate);
                } else {
                    eventEnd.value = formatDateTimeLocal(start);
                }
            } else {
                eventEnd.value = formatDateTimeLocal(end);
            }
        }
    }

    // RRule 포맷에 맞는 날짜 문자열 생성 (타임존 문제 해결)
    function getExdateString(date, dbStart, isAllDay) {
        const pad = (n) => n.toString().padStart(2, '0');
        // 사용지 요청에 따라 yyyyMMdd 형식으로 반환
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    }

    function getUntilString(date) {
        const pad = (n) => n.toString().padStart(2, '0');
        // UNTIL은 표준상 UTC여야 함. 로컬 날짜 기준으로 마지막 초로 설정
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T235959Z`;
    }

    // 모달 제어
    function openModal(dateStr, event = null) {
        currentEvent = event;
        modal.style.display = 'flex';
        if (event) {
            document.getElementById('modal-title').innerText = '일정 수정';
            eventInput.value = event.title || '';
            eventLocation.value = event.extendedProps.location || '';
            eventDesc.value = event.extendedProps.description || '';
            eventAllDay.checked = event.allDay || false;

            updateDateTimeInputs(event.allDay, event.start, event.end);

            parseRecurrenceRule(event.extendedProps.recurrence);

            // 반복 일정 인스턴스인 경우 범위 선택 UI 노출
            if (event.extendedProps.recurrence) {
                recurringChoice.classList.remove('hidden');
                document.querySelector('input[name="edit-type"][value="this"]').checked = true;
            } else {
                recurringChoice.classList.add('hidden');
            }

            if (event.extendedProps.url) {
                googleLinkBtn.classList.remove('hidden');
                googleLinkBtn.onclick = () => {
                    const { shell } = require('electron');
                    shell.openExternal(event.extendedProps.url);
                };
            } else {
                googleLinkBtn.classList.add('hidden');
            }

            document.getElementById('delete-event').classList.remove('hidden');

            // 배경색 설정 반영
            const eventColor = event.backgroundColor || '#3B82F6';
            let bgMatched = false;
            bgColors.forEach(circle => {
                if (circle.id === 'bg-custom-circle') return;
                if (circle.dataset.color === eventColor) {
                    circle.classList.add('active');
                    bgMatched = true;
                } else {
                    circle.classList.remove('active');
                }
            });

            const bgCustomCircle = document.getElementById('bg-custom-circle');
            if (!bgMatched) {
                bgCustomCircle.style.background = eventColor;
                bgCustomCircle.dataset.color = eventColor;
                bgCustomCircle.classList.add('active');
            } else {
                bgCustomCircle.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
                bgCustomCircle.dataset.color = '';
                bgCustomCircle.classList.remove('active');
            }

            // 글자색 설정 반영
            const eventTextColor = event.textColor || '#FFFFFF';
            let textMatched = false;
            textColors.forEach(circle => {
                if (circle.id === 'text-custom-circle') return;
                if (circle.dataset.color === eventTextColor) {
                    circle.classList.add('active');
                    textMatched = true;
                } else {
                    circle.classList.remove('active');
                }
            });

            const textCustomCircle = document.getElementById('text-custom-circle');
            if (!textMatched) {
                textCustomCircle.style.background = eventTextColor;
                textCustomCircle.dataset.color = eventTextColor;
                textCustomCircle.classList.add('active');
            } else {
                textCustomCircle.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
                textCustomCircle.dataset.color = '';
                textCustomCircle.classList.remove('active');
            }
        } else {
            document.getElementById('modal-title').innerText = '일정 추가';
            eventInput.value = '';
            eventLocation.value = '';
            eventDesc.value = '';
            eventAllDay.checked = false;

            updateDateTimeInputs(false, dateStr + 'T09:00', dateStr + 'T10:00');

            // 기본 색상(배경:파랑, 글자:흰색)으로 초기화
            bgColors.forEach(circle => {
                circle.classList.remove('active');
                if (circle.dataset.color === '#3B82F6') circle.classList.add('active');
            });
            const bgCustomCircle = document.getElementById('bg-custom-circle');
            bgCustomCircle.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
            bgCustomCircle.dataset.color = '';

            textColors.forEach(circle => {
                circle.classList.remove('active');
                if (circle.dataset.color === '#FFFFFF') circle.classList.add('active');
            });
            const textCustomCircle = document.getElementById('text-custom-circle');
            textCustomCircle.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
            textCustomCircle.dataset.color = '';
            parseRecurrenceRule(null);
            googleLinkBtn.classList.add('hidden');
            document.getElementById('delete-event').classList.add('hidden');
            recurringChoice.classList.add('hidden');
            currentEvent = { start: dateStr };
        }
    }

    document.getElementById('close-modal').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    document.getElementById('save-event').addEventListener('click', async () => {
        const title = eventInput.value;
        const location = eventLocation.value;
        const description = eventDesc.value;
        const allDay = eventAllDay.checked;
        const startStr = eventStart.value;
        const endStr = eventEnd.value;
        const recurrence = getRecurrenceRule();
        const recurrenceEnd = extractRecurrenceEnd(recurrence);

        const selectedBgCircle = document.querySelector('#bg-color-options .color-circle.active');
        const color = selectedBgCircle ? selectedBgCircle.dataset.color : '#3B82F6';

        const selectedTextCircle = document.querySelector('#text-color-options .color-circle.active');
        const textColor = selectedTextCircle ? selectedTextCircle.dataset.color : '#FFFFFF';

        if (!title) return;

        try {
            if (currentEvent.id) {
                const editTypeInput = document.querySelector('input[name="edit-type"]:checked');
                const editType = editTypeInput ? editTypeInput.value : 'all';

                if (editType === 'this' && currentEvent.extendedProps.recurrence) {
                    // 1. 현재 인스턴스만 수정: 기존 반복 일정에서 현재 시간을 제외(exdates 추가)
                    const isRecurring = currentEvent.extendedProps.recurrence;
                    const dbId = isRecurring
                        ? (currentEvent.extendedProps.originalId || Number(String(currentEvent.id).split('_')[0]))
                        : currentEvent.id;
                    const exdatesStr = currentEvent.extendedProps.exdates || '';
                    const instanceDate = currentEvent.start;
                    const pad = (n) => String(n).padStart(2, '0');
                    const instanceDateStr = `${instanceDate.getFullYear()}${pad(instanceDate.getMonth() + 1)}${pad(instanceDate.getDate())}`;
                    const newExdates = exdatesStr ? exdatesStr + ',' + instanceDateStr : instanceDateStr;

                    // 기존 이벤트를 업데이트하여 현재 인스턴스 숨김 (원본 시작일 db_start 사용)
                    await ipcRenderer.invoke('update-event', {
                        id: Number(dbId),
                        title: currentEvent.title,
                        start: currentEvent.extendedProps.db_start,
                        end: currentEvent.extendedProps.db_end || null,
                        description: currentEvent.extendedProps.description,
                        location: currentEvent.extendedProps.location,
                        all_day: currentEvent.allDay ? 1 : 0,
                        google_id: currentEvent.extendedProps.google_id,
                        url: currentEvent.extendedProps.url,
                        etag: currentEvent.extendedProps.etag,
                        status: currentEvent.extendedProps.status,
                        color_id: currentEvent.extendedProps.color_id,
                        color: currentEvent.backgroundColor,
                        text_color: currentEvent.textColor,
                        recurrence: currentEvent.extendedProps.recurrence,
                        exdates: newExdates,
                        recurrence_end: extractRecurrenceEnd(currentEvent.extendedProps.recurrence)
                    });

                    // 2. 새로운 단일 일정(standalone) 생성 (수정된 데이터로)
                    const newData = {
                        title: title,
                        start: startStr,
                        end: endStr || null,
                        description: description,
                        location: location,
                        all_day: allDay ? 1 : 0,
                        color: color,
                        text_color: textColor,
                        recurrence: null,
                        exdates: null
                    };
                    await ipcRenderer.invoke('add-event', newData);
                } else if (editType === 'future' && currentEvent.extendedProps.recurrence) {
                    // 1. 기존 일정의 종료일을 현재 인스턴스 전날로 변경
                    const isRecurringF = currentEvent.extendedProps.recurrence;
                    const dbIdF = isRecurringF
                        ? (currentEvent.extendedProps.originalId || Number(String(currentEvent.id).split('_')[0]))
                        : currentEvent.id;
                    const instanceDate = currentEvent.start;
                    const prevDate = new Date(instanceDate);
                    prevDate.setDate(prevDate.getDate() - 1);
                    const pad = (n) => String(n).padStart(2, '0');
                    const untilStr = `${prevDate.getFullYear()}${pad(prevDate.getMonth() + 1)}${pad(prevDate.getDate())}T235959Z`;

                    let oldRule = currentEvent.extendedProps.recurrence;
                    let newOldRule = oldRule.split(';').filter(p => !p.trim().startsWith('UNTIL=') && !p.trim().startsWith('COUNT=')).join(';');
                    newOldRule += `;UNTIL=${untilStr}`;

                    await ipcRenderer.invoke('update-event', {
                        id: Number(dbIdF),
                        title: currentEvent.title,
                        start: currentEvent.extendedProps.db_start,
                        end: currentEvent.extendedProps.db_end || null,
                        description: currentEvent.extendedProps.description,
                        location: currentEvent.extendedProps.location,
                        all_day: currentEvent.allDay ? 1 : 0,
                        google_id: currentEvent.extendedProps.google_id,
                        url: currentEvent.extendedProps.url,
                        etag: currentEvent.extendedProps.etag,
                        status: currentEvent.extendedProps.status,
                        color_id: currentEvent.extendedProps.color_id,
                        color: currentEvent.backgroundColor,
                        text_color: currentEvent.textColor,
                        recurrence: newOldRule,
                        exdates: currentEvent.extendedProps.exdates,
                        recurrence_end: extractRecurrenceEnd(newOldRule)
                    });

                    // 2. 현재 날짜부터 시작하는 새로운 일정 생성
                    const newData = {
                        title: title,
                        start: startStr,
                        end: endStr || null,
                        description: description,
                        location: location,
                        all_day: allDay ? 1 : 0,
                        color: color,
                        text_color: textColor,
                        recurrence: recurrence,
                        exdates: null,
                        recurrence_end: recurrenceEnd
                    };
                    await ipcRenderer.invoke('add-event', newData);
                } else {
                    // 모든 일정 수정 (기본 로직)
                    const isRecurringA = currentEvent.extendedProps.recurrence;
                    const dbIdA = isRecurringA
                        ? (currentEvent.extendedProps.originalId || Number(String(currentEvent.id).split('_')[0]))
                        : currentEvent.id;
                    const updatedData = {
                        id: Number(dbIdA),
                        title: title,
                        start: startStr,
                        end: endStr || null,
                        description: description,
                        location: location,
                        all_day: allDay ? 1 : 0,
                        google_id: currentEvent.extendedProps ? currentEvent.extendedProps.google_id : null,
                        url: currentEvent.extendedProps ? currentEvent.extendedProps.url : null,
                        etag: currentEvent.extendedProps ? currentEvent.extendedProps.etag : null,
                        status: currentEvent.extendedProps ? currentEvent.extendedProps.status : 'confirmed',
                        color_id: currentEvent.extendedProps ? currentEvent.extendedProps.color_id : null,
                        color: color,
                        text_color: textColor,
                        recurrence: recurrence,
                        exdates: currentEvent.extendedProps.exdates, // 기존 예외 날짜 유지
                        recurrence_end: recurrenceEnd
                    };
                    await ipcRenderer.invoke('update-event', updatedData);
                }
                window.location.reload();
            } else {
                const newData = {
                    title: title,
                    start: startStr,
                    end: endStr || null,
                    description: description,
                    location: location,
                    all_day: allDay ? 1 : 0,
                    google_id: null,
                    url: null,
                    etag: null,
                    status: 'confirmed',
                    color_id: null,
                    color: color,
                    text_color: textColor,
                    recurrence: recurrence,
                    recurrence_end: recurrenceEnd
                };
                console.log('Sending add-event:', newData);
                const newId = await ipcRenderer.invoke('add-event', newData);
                newData.id = newId;
                const singleEvt = formatSingleEvent(newData);
                if (singleEvt) calendar.addEvent(singleEvt);
                modal.style.display = 'none';
            }
        } catch (error) {
            console.error('Error saving event:', error);
            alert('일정 저장 중 오류가 발생했습니다: ' + error.message);
        }
    });

    // 종일 일정 토글 시 입력 필드 타입 변경
    eventAllDay.addEventListener('change', () => {
        const isAllDay = eventAllDay.checked;
        const currentStart = eventStart.value;
        const currentEnd = eventEnd.value;
        updateDateTimeInputs(isAllDay, currentStart, currentEnd);
    });

    // 색상 선택 이벤트 리스너
    bgColors.forEach(circle => {
        circle.addEventListener('click', () => {
            if (circle.id === 'bg-custom-circle') {
                document.getElementById('bg-color-picker').click();
                return;
            }
            bgColors.forEach(c => c.classList.remove('active'));
            circle.classList.add('active');
        });
    });

    document.getElementById('bg-color-picker').addEventListener('input', (e) => {
        const color = e.target.value;
        const customCircle = document.getElementById('bg-custom-circle');
        customCircle.style.background = color;
        customCircle.dataset.color = color;
        bgColors.forEach(c => c.classList.remove('active'));
        customCircle.classList.add('active');
    });

    textColors.forEach(circle => {
        circle.addEventListener('click', () => {
            if (circle.id === 'text-custom-circle') {
                document.getElementById('text-color-picker').click();
                return;
            }
            textColors.forEach(c => c.classList.remove('active'));
            circle.classList.add('active');
        });
    });

    document.getElementById('text-color-picker').addEventListener('input', (e) => {
        const color = e.target.value;
        const customCircle = document.getElementById('text-custom-circle');
        customCircle.style.background = color;
        customCircle.dataset.color = color;
        textColors.forEach(c => c.classList.remove('active'));
        customCircle.classList.add('active');
    });

    // 위젯 설정 관련
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    const syncCheckbox = document.getElementById('enable-google-sync');
    const autoStartCheckbox = document.getElementById('auto-start');
    const syncUploadCalendarRow = document.getElementById('sync-upload-calendar-row');
    const syncUploadCalendarSelect = document.getElementById('sync-upload-calendar-select');
    const syncDownloadCalendarRow = document.getElementById('sync-download-calendar-row');
    const syncDownloadCalendarList = document.getElementById('sync-download-calendar-list');

    function applyOpacity(opacity) {
        const transValue = Math.round((1 - opacity) * 100);
        opacitySlider.value = transValue;
        opacityValue.innerText = transValue + '%';
        // CSS 변수를 수정하여 위젯 배경만 투명해지도록 함 (팝업은 제외)
        document.documentElement.style.setProperty('--bg-opacity', opacity);
    }

    // 초기 설정 로드
    const appSettings = await ipcRenderer.invoke('get-settings');
    if (appSettings.opacity) {
        applyOpacity(parseFloat(appSettings.opacity));
    }
    if (appSettings.enableSync !== undefined) {
        const isEnabled = appSettings.enableSync === 'true';
        syncCheckbox.checked = isEnabled;
        document.getElementById('sync-btn').style.display = isEnabled ? 'flex' : 'none';
    }
    if (appSettings.autoStart !== undefined) {
        autoStartCheckbox.checked = appSettings.autoStart === 'true';
    }

    let currentSyncUploadCalendarId = appSettings.syncUploadCalendarId || 'primary';
    let currentSyncDownloadCalendarIds = appSettings.syncDownloadCalendarIds ? JSON.parse(appSettings.syncDownloadCalendarIds) : ['primary'];
    let currentSyncCalendarColors = appSettings.syncCalendarColors ? JSON.parse(appSettings.syncCalendarColors) : {};

    async function updateCalendarSelectUI() {
        if (!syncCheckbox.checked) {
            syncUploadCalendarRow.style.display = 'none';
            syncDownloadCalendarRow.style.display = 'none';
            return;
        }
        syncUploadCalendarRow.style.display = 'flex';
        syncDownloadCalendarRow.style.display = 'flex';
        try {
            const calendars = await ipcRenderer.invoke('get-calendars');
            syncUploadCalendarSelect.innerHTML = '<option value="primary" style="color: black;">기본 캘린더 (primary)</option>';
            syncDownloadCalendarList.innerHTML = '';

            // Add primary option for download
            const primaryLabel = document.createElement('label');
            primaryLabel.style.display = 'flex';
            primaryLabel.style.alignItems = 'center';
            primaryLabel.style.gap = '4px';
            const primaryColor = currentSyncCalendarColors['primary'] || '#3B82F6';
            primaryLabel.innerHTML = `
                <input type="checkbox" value="primary" ${currentSyncDownloadCalendarIds.includes('primary') ? 'checked' : ''}>
                <div class="cal-color-wrapper" style="position: relative; width: 16px; height: 16px; border-radius: 50%; background-color: ${primaryColor}; border: 1px solid rgba(255,255,255,0.3); overflow: hidden; display: inline-block; flex-shrink: 0; cursor: pointer;">
                    <input type="color" class="calendar-color-picker" data-id="primary" value="${primaryColor}" style="position: absolute; top: -10px; left: -10px; width: 40px; height: 40px; padding: 0; border: none; cursor: pointer; opacity: 0;">
                </div>
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">기본 캘린더 (primary)</span>
            `;
            syncDownloadCalendarList.appendChild(primaryLabel);

            if (calendars && calendars.length > 0) {
                calendars.forEach(cal => {
                    // Upload Select
                    const opt = document.createElement('option');
                    opt.value = cal.id;
                    opt.textContent = cal.summary + (cal.primary ? ' (기본)' : '');
                    opt.style.color = 'black';
                    syncUploadCalendarSelect.appendChild(opt);

                    // Download Checklist
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '4px';
                    const isChecked = currentSyncDownloadCalendarIds.includes(cal.id);
                    const calColor = currentSyncCalendarColors[cal.id] || cal.backgroundColor || '#3B82F6';
                    label.innerHTML = `
                        <input type="checkbox" value="${cal.id}" ${isChecked ? 'checked' : ''}>
                        <div class="cal-color-wrapper" style="position: relative; width: 16px; height: 16px; border-radius: 50%; background-color: ${calColor}; border: 1px solid rgba(255,255,255,0.3); overflow: hidden; display: inline-block; flex-shrink: 0; cursor: pointer;">
                            <input type="color" class="calendar-color-picker" data-id="${cal.id}" value="${calColor}" style="position: absolute; top: -10px; left: -10px; width: 40px; height: 40px; padding: 0; border: none; cursor: pointer; opacity: 0;">
                        </div>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cal.summary}${cal.primary ? ' (기본)' : ''}</span>
                    `;
                    syncDownloadCalendarList.appendChild(label);
                });
                syncUploadCalendarSelect.value = currentSyncUploadCalendarId;
            }

            // Bind checkbox events for download
            syncDownloadCalendarList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    const checkedBoxes = syncDownloadCalendarList.querySelectorAll('input[type="checkbox"]:checked');
                    currentSyncDownloadCalendarIds = Array.from(checkedBoxes).map(cb => cb.value);
                    ipcRenderer.send('update-setting', { key: 'syncDownloadCalendarIds', value: JSON.stringify(currentSyncDownloadCalendarIds) });
                });
            });

            // Bind color picker events
            syncDownloadCalendarList.querySelectorAll('input[type="color"]').forEach(colorPicker => {
                colorPicker.addEventListener('input', (e) => {
                    const calId = e.target.getAttribute('data-id');
                    e.target.parentElement.style.backgroundColor = e.target.value;
                });
                colorPicker.addEventListener('change', (e) => {
                    const calId = e.target.getAttribute('data-id');
                    currentSyncCalendarColors[calId] = e.target.value;
                    ipcRenderer.send('update-setting', { key: 'syncCalendarColors', value: JSON.stringify(currentSyncCalendarColors) });
                });
            });

        } catch (e) {
            console.error('Failed to load calendars', e);
        }
    }

    settingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
        updateCalendarSelectUI();
    });

    closeSettings.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });

    ipcRenderer.on('open-settings', () => {
        settingsModal.style.display = 'flex';
        updateCalendarSelectUI();
    });

    opacitySlider.addEventListener('input', (e) => {
        const transparency = parseInt(e.target.value);
        const opacity = (100 - transparency) / 100;
        opacityValue.innerText = transparency + '%';
        applyOpacity(opacity);
        ipcRenderer.send('update-setting', { key: 'opacity', value: opacity });
    });

    syncCheckbox.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        ipcRenderer.send('update-setting', { key: 'enableSync', value: isEnabled ? 'true' : 'false' });
        document.getElementById('sync-btn').style.display = isEnabled ? 'flex' : 'none';
        updateCalendarSelectUI();
    });

    syncUploadCalendarSelect.addEventListener('change', (e) => {
        currentSyncUploadCalendarId = e.target.value;
        ipcRenderer.send('update-setting', { key: 'syncUploadCalendarId', value: currentSyncUploadCalendarId });
    });

    if (autoStartCheckbox) {
        autoStartCheckbox.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            ipcRenderer.send('update-setting', { key: 'autoStart', value: isEnabled ? 'true' : 'false' });
        });
    }

    // 앱 닫기
    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.send('close-app');
    });

    document.getElementById('delete-event').addEventListener('click', async () => {
        if (currentEvent && currentEvent.id) {
            const editType = document.querySelector('input[name="edit-type"]:checked').value;
            const isRecurring = currentEvent.extendedProps.recurrence;
            // 반복 일정의 경우 originalId에서 DB id를 가져옴
            const dbId = isRecurring
                ? (currentEvent.extendedProps.originalId || Number(String(currentEvent.id).split('_')[0]))
                : currentEvent.id;

            if (editType === 'this' && isRecurring) {
                // 이 일정만 삭제: exdates에 현재 인스턴스 날짜 추가
                const exdatesStr = currentEvent.extendedProps.exdates || '';
                const instanceDate = currentEvent.start;
                const pad = (n) => String(n).padStart(2, '0');
                const instanceDateStr = `${instanceDate.getFullYear()}${pad(instanceDate.getMonth() + 1)}${pad(instanceDate.getDate())}`;
                const newExdates = exdatesStr ? exdatesStr + ',' + instanceDateStr : instanceDateStr;

                await ipcRenderer.invoke('update-event', {
                    id: Number(dbId),
                    title: currentEvent.title,
                    start: currentEvent.extendedProps.db_start,
                    end: currentEvent.extendedProps.db_end || null,
                    description: currentEvent.extendedProps.description,
                    location: currentEvent.extendedProps.location,
                    all_day: currentEvent.allDay ? 1 : 0,
                    color: currentEvent.backgroundColor,
                    text_color: currentEvent.textColor,
                    recurrence: currentEvent.extendedProps.recurrence,
                    exdates: newExdates,
                    recurrence_end: extractRecurrenceEnd(currentEvent.extendedProps.recurrence)
                });

                window.location.reload();
            } else if (editType === 'future' && isRecurring) {
                // 이후 모든 일정 삭제: UNTIL을 현재 인스턴스 전날로 설정
                const instanceDate = currentEvent.start;
                const prevDate = new Date(instanceDate);
                prevDate.setDate(prevDate.getDate() - 1);
                const pad = (n) => String(n).padStart(2, '0');
                const untilStr = `${prevDate.getFullYear()}${pad(prevDate.getMonth() + 1)}${pad(prevDate.getDate())}T235959Z`;

                let oldRule = currentEvent.extendedProps.recurrence;
                let newOldRule = oldRule.split(';').filter(p => !p.trim().startsWith('UNTIL=') && !p.trim().startsWith('COUNT=')).join(';');
                newOldRule += `;UNTIL=${untilStr}`;

                await ipcRenderer.invoke('update-event', {
                    id: Number(dbId),
                    title: currentEvent.title,
                    start: currentEvent.extendedProps.db_start,
                    end: currentEvent.extendedProps.db_end || null,
                    description: currentEvent.extendedProps.description,
                    location: currentEvent.extendedProps.location,
                    all_day: currentEvent.allDay ? 1 : 0,
                    color: currentEvent.backgroundColor,
                    text_color: currentEvent.textColor,
                    recurrence: newOldRule,
                    exdates: currentEvent.extendedProps.exdates,
                    recurrence_end: extractRecurrenceEnd(newOldRule)
                });
                window.location.reload();
            } else {
                // 모든 반복 일정 삭제 또는 단일 일정 삭제
                await ipcRenderer.invoke('delete-event', Number(dbId));
                window.location.reload();
            }
            modal.style.display = 'none';
        }
    });
});
