const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const { app, shell } = require('electron');

const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
// 앱 내부에 포함된 credentials.json 을 읽도록 경로 변경 (루트 폴더 기준)
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

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
                    scope: ['https://www.googleapis.com/auth/calendar.events'],
                });
                shell.openExternal(authUrl);
            });
        });
    }

    async listEvents() {
        const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
        // 과거 일정도 가져오도록 1년 전부터 조회
        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);

        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: lastYear.toISOString(),
            maxResults: 250,
            singleEvents: true,
            orderBy: 'startTime',
        });
        return res.data.items;
    }

    async addEvent(eventData) {
        const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
        const event = {
            summary: eventData.title,
            description: eventData.description,
            start: { dateTime: new Date(eventData.start).toISOString() },
            end: { dateTime: eventData.end ? new Date(eventData.end).toISOString() : new Date(eventData.start).toISOString() },
        };
        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });
        return res.data.id;
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
