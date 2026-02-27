const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const { app, shell } = require('electron');
const db = require('./db');

const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
// 앱 내부에 포함된 credentials.json 을 읽도록 경로 변경 (루트 폴더 기준)
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Monkey patch generateAuthUrl to add required scope for calendarList
const originalGenerateAuthUrl = google.auth.OAuth2.prototype.generateAuthUrl;
google.auth.OAuth2.prototype.generateAuthUrl = function (opts) {
    if (opts && opts.scope) {
        if (Array.isArray(opts.scope)) {
            if (!opts.scope.includes('https://www.googleapis.com/auth/calendar.readonly')) {
                opts.scope.push('https://www.googleapis.com/auth/calendar.readonly');
            }
            if (!opts.scope.includes('https://www.googleapis.com/auth/tasks.readonly')) {
                opts.scope.push('https://www.googleapis.com/auth/tasks.readonly');
            }
        }
    }
    return originalGenerateAuthUrl.call(this, opts);
};

class GoogleSync {
    constructor() {
        this.oAuth2Client = null;
    }

    async authorize() {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            throw new Error('앱 내부에 credentials.json 파일이 없습니다. 앱 배포 시 포함되어야 합니다.');
        }

        const content = fs.readFileSync(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

        // 자동으로 로컬 호스트 URI를 우선적으로 사용
        // (사용자가 Google Cloud Console에서 http://127.0.0.1 이나 http://localhost 로 설정했다고 가정)
        let redirect_uri = 'http://127.0.0.1';
        if (redirect_uris && redirect_uris.length > 0) {
            const localhostUri = redirect_uris.find(u => u.includes('localhost') || u.includes('127.0.0.1'));
            if (localhostUri) {
                redirect_uri = localhostUri;
            } else {
                redirect_uri = redirect_uris[0];
            }
        }

        this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

        if (fs.existsSync(TOKEN_PATH)) {
            const token = fs.readFileSync(TOKEN_PATH);
            this.oAuth2Client.setCredentials(JSON.parse(token));
            return true;
        }

        // 토큰이 없으면 로컬 서버를 띄워서 새 토큰을 자동 발급 (가로채기) 진행
        return await this.getNewTokenAutomatic(redirect_uri);
    }

    async getNewTokenAutomatic(redirectUri) {
        return new Promise((resolve, reject) => {
            // redirect_uri에서 포트 번호 추출 (없으면 80 가정)
            const parsedUrl = url.parse(redirectUri);
            const port = parsedUrl.port || 80;

            const server = http.createServer(async (req, res) => {
                try {
                    const reqUrl = url.parse(req.url, true);
                    if (reqUrl.query.error) {
                        res.end('Authentication Error: ' + reqUrl.query.error);
                        server.close();
                        reject(new Error(reqUrl.query.error));
                        return;
                    }

                    if (reqUrl.query.code) {
                        const code = reqUrl.query.code;
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>인증이 완료되었습니다.</h1><p>이 창을 닫아주세요.</p><script>window.close();</script>');
                        server.close();

                        const { tokens } = await this.oAuth2Client.getToken(code);
                        this.oAuth2Client.setCredentials(tokens);
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                        resolve(true); // 인증 성공
                    }
                } catch (e) {
                    res.end('Error processing authentication.');
                    server.close();
                    reject(e);
                }
            });

            server.on('error', (e) => {
                if (e.code === 'EADDRINUSE') {
                    reject(new Error(`포트 ${port}가 이미 사용 중입니다. Google Cloud Console의 리디렉션 URI 설정을 확인해주세요.`));
                } else {
                    reject(e);
                }
            });

            server.listen(port, () => {
                // 서버가 시작되면 브라우저 열기
                const authUrl = this.oAuth2Client.generateAuthUrl({
                    access_type: 'offline',
                    scope: [
                        'https://www.googleapis.com/auth/calendar.events',
                        'https://www.googleapis.com/auth/tasks.readonly'
                    ],
                });
                shell.openExternal(authUrl);
            });
        });
    }

    async getCalendars() {
        if (!this.oAuth2Client) throw new Error("Not Authorized");
        const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
        const res = await calendar.calendarList.list();
        return res.data.items;
    }

    async listEvents() {
        const settings = db.getSettings();
        let calendarIds = ['primary'];
        if (settings.syncDownloadCalendarIds) {
            try {
                calendarIds = JSON.parse(settings.syncDownloadCalendarIds);
            } catch (e) {
                console.error('Error parsing syncDownloadCalendarIds', e);
            }
        }
        const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
        // 과거 일정도 가져오도록 1년 전부터 조회
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
    }

    async listTasks() {
        if (!this.oAuth2Client) throw new Error("Not Authorized");
        const tasksAPI = google.tasks({ version: 'v1', auth: this.oAuth2Client });
        let allTasks = [];
        try {
            const taskListsRes = await tasksAPI.tasklists.list();
            const taskLists = taskListsRes.data.items || [];

            const lastYear = new Date();
            lastYear.setFullYear(lastYear.getFullYear() - 1);

            for (const taskList of taskLists) {
                try {
                    const tasksRes = await tasksAPI.tasks.list({
                        tasklist: taskList.id,
                        showCompleted: true,
                        showHidden: true,
                        updatedMin: lastYear.toISOString(), // 가져올 태스크의 최소 수정 일자
                        maxResults: 1000
                    });

                    if (tasksRes.data.items) {
                        tasksRes.data.items.forEach(task => {
                            task._sourceTaskListId = taskList.id;
                        });
                        allTasks = allTasks.concat(tasksRes.data.items);
                    }
                } catch (e) {
                    console.error(`Error listing tasks for list ${taskList.id}`, e.message);
                }
            }
        } catch (e) {
            console.error('Error listing task lists', e.message);
        }
        return allTasks;
    }

    async addEvent(eventData) {
        const settings = db.getSettings();
        const calendarId = settings.syncUploadCalendarId || 'primary';
        const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });

        let start, end;
        if (eventData.all_day === 1 || eventData.all_day === true) {
            start = { date: eventData.start.split('T')[0] };
            if (eventData.end) {
                // If there's an end date, we need to add 1 day for Google's exclusive end date for all-day events
                const endDate = new Date(eventData.end);
                // Ensure it's valid
                if (!isNaN(endDate.getTime())) {
                    endDate.setDate(endDate.getDate() + 1);
                    end = { date: endDate.toISOString().split('T')[0] };
                } else {
                    end = start;
                }
            } else {
                end = start;
            }
        } else {
            start = { dateTime: new Date(eventData.start).toISOString() };
            end = { dateTime: eventData.end ? new Date(eventData.end).toISOString() : new Date(eventData.start).toISOString() };
        }

        const event = {
            summary: eventData.title,
            description: eventData.description,
            location: eventData.location,
            start: start,
            end: end,
        };
        const res = await calendar.events.insert({
            calendarId: calendarId,
            resource: event,
        });
        return res.data.id;
    }

    async updateEvent(googleId, eventData) {
        if (!googleId) return null;
        const settings = db.getSettings();
        let calendarIds = [settings.syncUploadCalendarId || 'primary'];
        if (settings.syncDownloadCalendarIds) {
            try {
                const down = JSON.parse(settings.syncDownloadCalendarIds);
                calendarIds = [...new Set([...calendarIds, ...down])];
            } catch (e) { }
        }
        const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });

        let start, end;
        if (eventData.all_day === 1 || eventData.all_day === true) {
            start = { date: eventData.start.split('T')[0] };
            if (eventData.end) {
                const endDate = new Date(eventData.end);
                if (!isNaN(endDate.getTime())) {
                    endDate.setDate(endDate.getDate() + 1);
                    end = { date: endDate.toISOString().split('T')[0] };
                } else {
                    end = start;
                }
            } else {
                end = start;
            }
        } else {
            start = { dateTime: new Date(eventData.start).toISOString() };
            end = { dateTime: eventData.end ? new Date(eventData.end).toISOString() : new Date(eventData.start).toISOString() };
        }

        const event = {
            summary: eventData.title,
            description: eventData.description,
            location: eventData.location,
            start: start,
            end: end,
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
        console.error('updateEvent Error:', lastError ? lastError.message : 'Unknown error');
        return null;
    }

    async deleteEvent(googleId) {
        if (!googleId) return false;
        const settings = db.getSettings();
        let calendarIds = [settings.syncUploadCalendarId || 'primary'];
        if (settings.syncDownloadCalendarIds) {
            try {
                const down = JSON.parse(settings.syncDownloadCalendarIds);
                calendarIds = [...new Set([...calendarIds, ...down])];
            } catch (e) { }
        }
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
        console.error('deleteEvent Error:', lastError ? lastError.message : 'Unknown error');
        return false;
    }

    clearCredentials() {
        if (fs.existsSync(TOKEN_PATH)) {
            try {
                fs.unlinkSync(TOKEN_PATH);
                console.log('token.json 파일이 삭제되었습니다.');
            } catch (err) {
                console.error('token.json 파일 삭제 중 오류 발생:', err);
            }
        }
        this.oAuth2Client = null;
    }
}

module.exports = new GoogleSync();
