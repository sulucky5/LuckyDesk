const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { app, shell } = require('electron');

const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.json');

// 참고: 사용자가 Google Cloud Console에서 credentials.json을 다운로드하여
// 앱 데이터 폴더에 저장해야 함.

class GoogleSync {
    constructor() {
        this.oAuth2Client = null;
    }

    async authorize() {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            throw new Error('credentials.json 파일이 없습니다. Google Cloud Console에서 발급받아주세요.');
        }

        const content = fs.readFileSync(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        if (fs.existsSync(TOKEN_PATH)) {
            const token = fs.readFileSync(TOKEN_PATH);
            this.oAuth2Client.setCredentials(JSON.parse(token));
            return true;
        }
        return false;
    }

    getAuthUrl() {
        return this.oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar.events'],
        });
    }

    async saveToken(code) {
        const { tokens } = await this.oAuth2Client.getToken(code);
        this.oAuth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
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
}

module.exports = new GoogleSync();
