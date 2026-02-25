const fs = require('fs');
const path = require('path');
require('dotenv').config();

const clientId = process.env.GOOGLE_CLIENT_ID;
const projectId = process.env.GOOGLE_PROJECT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !projectId || !clientSecret) {
    console.warn('⚠️  Warning: Missing Google API credentials in .env file.');
    console.warn('⚠️  Please ensure GOOGLE_CLIENT_ID, GOOGLE_PROJECT_ID, GOOGLE_CLIENT_SECRET are set if you want to use Google Sync feature.');
} else {
    const credentials = {
        installed: {
            client_id: clientId,
            project_id: projectId,
            auth_uri: 'https://accounts.google.com/o/oauth2/auth',
            token_uri: 'https://oauth2.googleapis.com/token',
            auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
            client_secret: clientSecret,
            redirect_uris: ['http://localhost', 'http://127.0.0.1']
        }
    };

    const targetPath = path.join(__dirname, '..', 'credentials.json');
    fs.writeFileSync(targetPath, JSON.stringify(credentials, null, 2), 'utf8');
    console.log('✅ credentials.json has been successfully generated from .env file.');
}
