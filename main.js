const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const db = require('./db');
const googleSync = require('./google-sync');

/* === GOOGLE SYNC MONKEY PATCH START === */
const { google } = require('googleapis');
// Monkey patch generateAuthUrl to add required scope for calendarList
const originalGenerateAuthUrl = google.auth.OAuth2.prototype.generateAuthUrl;
google.auth.OAuth2.prototype.generateAuthUrl = function (opts) {
    if (opts && opts.scope) {
        if (Array.isArray(opts.scope)) {
            if (!opts.scope.includes('https://www.googleapis.com/auth/calendar.readonly')) {
                opts.scope.push('https://www.googleapis.com/auth/calendar.readonly');
            }
        }
    }
    return originalGenerateAuthUrl.call(this, opts);
};

// We monkey patch googleSync to avoid touching the obfuscated credentials
googleSync.getCalendars = async function () {
    const { google } = require('googleapis');
    if (!this.oAuth2Client) throw new Error("Not Authorized");
    const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
    const res = await calendar.calendarList.list();
    return res.data.items;
};

googleSync.listEvents = async function () {
    const settings = db.getSettings();
    let calendarIds = ['primary'];
    if (settings.syncDownloadCalendarIds) {
        try {
            calendarIds = JSON.parse(settings.syncDownloadCalendarIds);
        } catch (e) {
            console.error('Error parsing syncDownloadCalendarIds', e);
        }
    }
    const { google } = require('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);

    let allEvents = [];
    for (const calendarId of calendarIds) {
        try {
            const res = await calendar.events.list({
                calendarId: calendarId,
                timeMin: lastYear.toISOString(),
                maxResults: 500,
                singleEvents: true,
                orderBy: 'startTime',
            });
            if (res.data.items) {
                res.data.items.forEach(item => item._sourceCalendarId = calendarId);
                allEvents = allEvents.concat(res.data.items);
            }
        } catch (e) {
            console.error(`Error listing events for calendar ${calendarId}`, e.message);
        }
    }
    return allEvents;
};

googleSync.addEvent = async function (eventData) {
    const settings = db.getSettings();
    const calendarId = settings.syncUploadCalendarId || 'primary';
    const { google } = require('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
    const event = {
        summary: eventData.title,
        description: eventData.description,
        start: { dateTime: new Date(eventData.start).toISOString() },
        end: { dateTime: eventData.end ? new Date(eventData.end).toISOString() : new Date(eventData.start).toISOString() },
    };
    const res = await calendar.events.insert({
        calendarId: calendarId,
        resource: event,
    });
    return res.data.id;
};

googleSync.updateEvent = async function (googleId, eventData) {
    if (!googleId) return null;
    const settings = db.getSettings();
    let calendarIds = [settings.syncUploadCalendarId || 'primary'];
    if (settings.syncDownloadCalendarIds) {
        try {
            const down = JSON.parse(settings.syncDownloadCalendarIds);
            calendarIds = [...new Set([...calendarIds, ...down])];
        } catch (e) { }
    }
    const { google } = require('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
    const event = {
        summary: eventData.title,
        description: eventData.description,
        start: { dateTime: new Date(eventData.start).toISOString() },
        end: { dateTime: eventData.end ? new Date(eventData.end).toISOString() : new Date(eventData.start).toISOString() },
    };

    let lastError = null;
    for (const calId of calendarIds) {
        try {
            const res = await calendar.events.update({
                calendarId: calId,
                eventId: googleId,
                resource: event,
            });
            return res.data;
        } catch (e) {
            lastError = e;
        }
    }
    console.error('updateEvent Error:', lastError.message);
    return null;
};

googleSync.deleteEvent = async function (googleId) {
    if (!googleId) return false;
    const settings = db.getSettings();
    let calendarIds = [settings.syncUploadCalendarId || 'primary'];
    if (settings.syncDownloadCalendarIds) {
        try {
            const down = JSON.parse(settings.syncDownloadCalendarIds);
            calendarIds = [...new Set([...calendarIds, ...down])];
        } catch (e) { }
    }
    const { google } = require('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });

    let lastError = null;
    for (const calId of calendarIds) {
        try {
            await calendar.events.delete({
                calendarId: calId,
                eventId: googleId,
            });
            return true;
        } catch (e) {
            lastError = e;
        }
    }
    console.error('deleteEvent Error:', lastError.message);
    return false;
};
/* === GOOGLE SYNC MONKEY PATCH END === */

let tray = null;
let mainWindow = null;
function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // 설정 로드
    const settings = db.getSettings();
    const savedBounds = settings.bounds ? JSON.parse(settings.bounds) : {
        width: Math.floor(screenWidth / 2),
        height: Math.floor(screenHeight / 2),
        x: undefined,
        y: undefined
    };
    const savedOpacity = settings.opacity ? parseFloat(settings.opacity) : 1.0;

    const win = new BrowserWindow({
        width: savedBounds.width,
        height: savedBounds.height,
        x: savedBounds.x,
        y: savedBounds.y,
        transparent: true,
        frame: false,
        hasShadow: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        resizable: true,
        movable: true,
        alwaysOnTop: false,
        icon: path.join(__dirname, 'assets/icon.png'),
        type: 'toolbar',
    });

    mainWindow = win;

    // 배경화면처럼 동작하기 위한 설정
    win.setAlwaysOnTop(false);

    // 자동 실행 설정 반영
    app.setLoginItemSettings({
        openAtLogin: settings.autoStart === 'true',
        openAsHidden: false
    });

    // Renderer 프로세스 로그 포워딩
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer] ${message} (line ${line})`);
    });

    win.loadFile('index.html');

    // 마우스 이벤트 무시 여부 제어
    ipcMain.on('set-ignore-mouse', (event, ignore, options) => {
        const defaultOptions = { forward: ignore };
        win.setIgnoreMouseEvents(ignore, options || defaultOptions);
    });

    ipcMain.on('set-window-bounds', (event, bounds) => {
        if (!win) return;
        const { x, y, width, height, x_delta, y_delta } = bounds;
        const currentBounds = win.getBounds();

        let newX = x !== undefined ? Math.round(x) : currentBounds.x;
        let newY = y !== undefined ? Math.round(y) : currentBounds.y;

        if (x_delta !== undefined) newX += Math.round(x_delta);
        if (y_delta !== undefined) newY += Math.round(y_delta);

        const newWidth = width !== undefined ? Math.round(width) : currentBounds.width;
        const newHeight = height !== undefined ? Math.round(height) : currentBounds.height;

        const finalBounds = {
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
        };

        win.setBounds(finalBounds);
        // 설정 저장
        db.updateSetting('bounds', JSON.stringify(finalBounds));
    });

    ipcMain.on('update-setting', (event, { key, value }) => {
        db.updateSetting(key, value);
        if (key === 'enableSync' && value === 'false') {
            googleSync.clearCredentials();
        }
        if (key === 'autoStart') {
            app.setLoginItemSettings({
                openAtLogin: value === 'true',
                openAsHidden: false
            });
        }
    });

    ipcMain.on('set-editable', (event, editable) => {
        win.setResizable(editable);
        win.setMovable(editable);
    });

    ipcMain.on('close-app', () => {
        app.quit();
    });
}

app.whenReady().then(() => {
    createWindow();

    // 트레이 아이콘 생성
    const iconPath = path.join(__dirname, 'assets/icon.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

    tray = new Tray(icon);
    tray.setToolTip('LuckyDesk');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '설정',
            click: () => {
                if (mainWindow) {
                    mainWindow.setAlwaysOnTop(true);
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.setAlwaysOnTop(false);
                    mainWindow.webContents.send('open-settings');
                }
            }
        },
        {
            label: '종료',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    // 트레이 아이콘 빈 공간 클릭 시에도 창 활성화
    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC 핸들러 (데이터베이스 통신)
ipcMain.handle('get-events', async (event, range) => {
    if (range) {
        return db.getEvents(range.start, range.end);
    }
    return db.getEvents();
});

// 양방향 동기화 헬퍼 함수
async function pushToGoogleIfEnabled(action, data, id) {
    const settings = db.getSettings();
    if (settings.enableSync === 'true') {
        try {
            await googleSync.authorize(); // 토큰이 유효한지 확인
            if (action === 'add') {
                const googleId = await googleSync.addEvent(data);
                db.updateGoogleId(id, googleId);
            } else if (action === 'update' && data.google_id) {
                await googleSync.updateEvent(data.google_id, data);
            } else if (action === 'delete') {
                // data가 google_id 일경우 바로 삭제 (deleteEvent 호출 시 넘겨받음)
                await googleSync.deleteEvent(data);
            }
        } catch (e) {
            console.error(`구글 캘린더 양방향 동기화(${action}) 중 에러:`, e.message);
        }
    }
}

ipcMain.handle('add-event', async (event, data) => {
    const newId = db.addEvent(data);
    pushToGoogleIfEnabled('add', data, newId);
    return newId;
});

ipcMain.handle('update-event', async (event, data) => {
    const result = db.updateEvent(data);
    pushToGoogleIfEnabled('update', data, data.id);
    return result;
});

ipcMain.handle('delete-event', async (event, id) => {
    const eventData = db.getEventById(id);
    const result = db.deleteEvent(id);
    if (eventData && eventData.google_id) {
        pushToGoogleIfEnabled('delete', eventData.google_id, id);
    }
    return result;
});

// 구글 동기화 관련
ipcMain.handle('sync-google', async () => {
    try {
        const tokenPath = path.join(app.getPath('userData'), 'token.json');
        if (require('fs').existsSync(tokenPath)) {
            try {
                const tokenStr = require('fs').readFileSync(tokenPath, 'utf8');
                const token = JSON.parse(tokenStr);
                // Check if we have the needed scope for calendars read
                if (!token.scope || !token.scope.includes('https://www.googleapis.com/auth/calendar.readonly')) {
                    googleSync.clearCredentials();
                }
            } catch (e) {
                googleSync.clearCredentials();
            }
        }

        await googleSync.authorize();

        const googleEvents = await googleSync.listEvents();
        const settings = db.getSettings();
        let calendarColors = {};
        if (settings.syncCalendarColors) {
            try { calendarColors = JSON.parse(settings.syncCalendarColors); } catch (e) { }
        }
        const existingEvents = db.getEvents();
        const existingGoogleIds = new Set(existingEvents.filter(e => e.google_id).map(e => e.google_id));

        for (const gEvent of googleEvents) {
            // 반복규칙에서 종료일 추출
            let recurrenceEnd = null;
            const recurrenceStr = gEvent.recurrence ? gEvent.recurrence.join(';') : null;
            if (recurrenceStr) {
                const ruleParts = recurrenceStr.split(';');
                for (const rp of ruleParts) {
                    const trimmed = rp.trim();
                    if (trimmed.startsWith('UNTIL=')) {
                        const untilVal = trimmed.substring(6);
                        const digits = untilVal.replace(/[^0-9]/g, '').substring(0, 8);
                        if (digits.length === 8) {
                            recurrenceEnd = `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`;
                        }
                    }
                }
            }

            const eventData = {
                title: gEvent.summary || '(제목 없음)',
                start: gEvent.start.dateTime || gEvent.start.date,
                end: gEvent.end.dateTime || gEvent.end.date,
                description: gEvent.description || '',
                location: gEvent.location || '',
                all_day: gEvent.start.date ? 1 : 0,
                google_id: gEvent.id,
                url: gEvent.htmlLink || '',
                etag: gEvent.etag || '',
                status: gEvent.status || 'confirmed',
                color_id: gEvent.colorId || '',
                color: calendarColors[gEvent._sourceCalendarId] || '',
                recurrence: recurrenceStr,
                recurrence_end: recurrenceEnd
            };

            if (existingGoogleIds.has(gEvent.id)) {
                // 기존 일정 업데이트 (간단히 google_id 기준으로 매칭)
                const localEvent = existingEvents.find(e => e.google_id === gEvent.id);
                eventData.id = localEvent.id;
                db.updateEvent(eventData);
            } else {
                // 새 일정 추가
                db.addEvent(eventData);
            }
        }
        return { status: 'success' };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
});



ipcMain.handle('get-calendars', async () => {
    try {
        const tokenPath = path.join(app.getPath('userData'), 'token.json');
        if (require('fs').existsSync(tokenPath)) {
            try {
                const tokenStr = require('fs').readFileSync(tokenPath, 'utf8');
                const token = JSON.parse(tokenStr);
                if (!token.scope || !token.scope.includes('https://www.googleapis.com/auth/calendar.readonly')) {
                    googleSync.clearCredentials(); // 기존 토큰 삭제하여 재인증 유도
                }
            } catch (e) {
                googleSync.clearCredentials();
            }
        }

        await googleSync.authorize();
        return await googleSync.getCalendars();
    } catch (error) {
        console.error('get-calendars Error:', error);
        return [];
    }
});

ipcMain.handle('get-settings', async () => {
    return db.getSettings();
});
