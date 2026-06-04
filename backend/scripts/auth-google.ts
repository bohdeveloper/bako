import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as url from 'url';

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
];

async function main() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000');

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n🔗 Abre esta URL en el navegador:\n');
  console.log(authUrl);
  console.log('\n⏳ Esperando autorización en http://localhost:3000 ...\n');

  // Servidor local para capturar el código de OAuth
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const params = new url.URL(req.url!, 'http://localhost:3000').searchParams;
      const code = params.get('code');
      if (code) {
        res.end('<h2>✅ BAKO autorizado. Puedes cerrar esta ventana.</h2>');
        server.close();
        resolve(code);
      } else {
        res.end('<h2>❌ Error — no se recibió el código.</h2>');
        server.close();
        reject(new Error('No se recibió el código de autorización'));
      }
    });
    server.listen(3000);
  });

  const { tokens } = await oAuth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('✅ token.json guardado en:', TOKEN_PATH);
  console.log('🚀 Google Calendar + Gmail listos para BAKO.');
  console.log('\n📋 Siguiente paso — actualizar Render:');
  console.log('   1. Copia el contenido de token.json (una sola línea):');
  console.log('      node -e "console.log(JSON.stringify(require(\'./token.json\')))"\n');
  console.log('   2. Pega ese valor en GOOGLE_TOKEN_JSON en el dashboard de Render.\n');
}

main().catch(console.error);
