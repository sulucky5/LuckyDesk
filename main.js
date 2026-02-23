const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const db = require('./db');
const googleSync = require('./google-sync');

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

    ipcMain.on('set-opacity', (event, opacity) => {
        // 더 이상 win.setOpacity를 사용하지 않고 렌더러에서 CSS로 처리하도록 함
        db.updateSetting('opacity', opacity);
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
                    mainWindow.show();
                    mainWindow.focus();
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

ipcMain.handle('add-event', async (event, data) => {
    return db.addEvent(data);
});

ipcMain.handle('update-event', async (event, data) => {
    return db.updateEvent(data);
});

ipcMain.handle('delete-event', async (event, id) => {
    return db.deleteEvent(id);
});

// 구글 동기화 관련
ipcMain.handle('sync-google', async () => {
    try {
        const isAuthorized = await googleSync.authorize();
        if (!isAuthorized) {
            const authUrl = googleSync.getAuthUrl();
            shell.openExternal(authUrl);
            return { status: 'need-auth' };
        }

        const googleEvents = await googleSync.listEvents();
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

ipcMain.handle('submit-google-code', async (event, code) => {
    await googleSync.saveToken(code);
    return { status: 'success' };
});

ipcMain.handle('get-settings', async () => {
    return db.getSettings();
});
