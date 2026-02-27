const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'luckydesk.db');
const db = new Database(dbPath);

// 테이블 생성
db.prepare(`
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT,
        description TEXT,
        location TEXT,
        all_day INTEGER DEFAULT 0,
        google_id TEXT UNIQUE,
        url TEXT,
        etag TEXT,
        status TEXT,
        color_id TEXT,
        color TEXT,
        text_color TEXT,
        recurrence TEXT,
        exdates TEXT,
        recurrence_end TEXT,
        last_synced TEXT
    )
`).run();

// 컬럼 추가 (기존 테이블 대응)
const addColumn = (name, type) => {
    try {
        db.prepare(`ALTER TABLE events ADD COLUMN ${name} ${type}`).run();
    } catch (e) {
        // 이미 컬럼이 존재하는 경우 무시
    }
};

addColumn('location', 'TEXT');
addColumn('all_day', 'INTEGER DEFAULT 0');
addColumn('url', 'TEXT');
addColumn('etag', 'TEXT');
addColumn('status', 'TEXT');
addColumn('color_id', 'TEXT');
addColumn('color', 'TEXT');
addColumn('text_color', 'TEXT');
addColumn('recurrence', 'TEXT');
addColumn('exdates', 'TEXT');
addColumn('recurrence_end', 'TEXT');

module.exports = {
    getEvents: (startDate, endDate) => {
        if (startDate && endDate) {
            // 1. 단일 일정 (반복 안함): 일정이 보여지는 범위 내에 있는 경우
            // 2. 반복 일정: 시리즈 시작이 범위 끝 이전이고, recurrence_end가 범위 시작 이후인 경우
            return db.prepare(`
                SELECT * FROM events 
                WHERE (status IS NULL OR status != 'cancelled')
                AND (
                    (recurrence IS NULL AND start < ? AND (end IS NULL OR end > ?))
                    OR 
                    (recurrence IS NOT NULL AND start < ? AND (recurrence_end IS NULL OR recurrence_end >= ?))
                )
            `).all(endDate, startDate, endDate, startDate);
        }
        return db.prepare("SELECT * FROM events WHERE status IS NULL OR status != 'cancelled'").all();
    },
    getEventById: (id) => {
        return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    },
    getAllRecurringEvents: () => {
        return db.prepare("SELECT * FROM events WHERE recurrence IS NOT NULL AND (status IS NULL OR status != 'cancelled')").all();
    },
    addEvent: (event) => {
        const info = db.prepare(`
            INSERT INTO events (title, start, end, description, location, all_day, google_id, url, etag, status, color_id, color, text_color, recurrence, exdates, recurrence_end) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            event.title, event.start, event.end, event.description,
            event.location, event.all_day ? 1 : 0, event.google_id,
            event.url, event.etag, event.status, event.color_id, event.color, event.text_color, event.recurrence, event.exdates || null, event.recurrence_end || null
        );
        return info.lastInsertRowid;
    },
    updateEvent: (event) => {
        return db.prepare(`
            UPDATE events 
            SET title = ?, start = ?, end = ?, description = ?, location = ?, all_day = ?, 
                google_id = ?, url = ?, etag = ?, status = ?, color_id = ?, color = ?, text_color = ?, recurrence = ?, exdates = ?, recurrence_end = ? 
            WHERE id = ?
        `).run(
            event.title, event.start, event.end, event.description,
            event.location, event.all_day ? 1 : 0, event.google_id,
            event.url, event.etag, event.status, event.color_id, event.color, event.text_color, event.recurrence, event.exdates || null, event.recurrence_end || null, event.id
        );
    },
    deleteEvent: (id) => {
        return db.prepare('DELETE FROM events WHERE id = ?').run(id);
    },
    updateGoogleId: (id, googleId) => {
        return db.prepare('UPDATE events SET google_id = ? WHERE id = ?').run(googleId, id);
    },
    clearGoogleSyncData: (deleteEvents = false) => {
        if (deleteEvents) {
            // 구글 연동된 일정(google_id가 있는 일정) 모두 삭제
            db.prepare('DELETE FROM events WHERE google_id IS NOT NULL').run();
        } else {
            // 구글 연동된 일정의 연동 정보(google_id 등)만 초기화하고 이벤트 자체는 유지
            db.prepare('UPDATE events SET google_id = NULL, etag = NULL, url = NULL WHERE google_id IS NOT NULL').run();
        }
        // 설정에서 구글 연동 관련 값 삭제
        db.prepare(`DELETE FROM settings WHERE key IN ('syncUploadCalendarId', 'syncDownloadCalendarIds', 'syncCalendarColors', 'syncCalendarTextColors')`).run();
    },
    resetApp: () => {
        db.prepare('DELETE FROM events').run();
        db.prepare('DELETE FROM settings').run();
        db.prepare('VACUUM').run();
    },
    // 설정 관련
    getSettings: () => {
        db.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)').run();
        const rows = db.prepare('SELECT * FROM settings').all();
        const settings = {};
        rows.forEach(row => { settings[row.key] = row.value; });
        return settings;
    },
    updateSetting: (key, value) => {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    }
};
