import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

export interface GmailMessage {
  id:       string;
  threadId: string;
  from:     string;
  fromName: string;
  to:       string;
  subject:  string;
  snippet:  string;
  body:     string;
  date:     string;
  unread:   boolean;
}

function getAuth() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_TOKEN_JSON) {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:3000'
    );
    auth.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN_JSON));
    return auth;
  }

  const credPath  = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH ?? './credentials.json');
  const tokenPath = path.resolve(process.env.GOOGLE_TOKEN_PATH       ?? './token.json');

  if (!fs.existsSync(credPath))  throw new Error('credentials.json no encontrado');
  if (!fs.existsSync(tokenPath)) throw new Error('token.json no encontrado — ejecuta: npx ts-node scripts/auth-google.ts');

  const { installed } = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3000');
  auth.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf-8')));
  return auth;
}

function parseFrom(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
  return { name: raw.trim(), email: raw.trim() };
}

export async function getUnreadEmails(limit = 10): Promise<GmailMessage[]> {
  const auth  = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const { data: list } = await gmail.users.messages.list({
    userId:     'me',
    q:          'is:unread in:inbox',
    maxResults: limit,
  });

  if (!list.messages?.length) return [];

  const messages = await Promise.all(
    list.messages.map(async ({ id }) => {
      const { data: msg } = await gmail.users.messages.get({
        userId:          'me',
        id:              id!,
        format:          'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const headers   = msg.payload?.headers ?? [];
      const getHeader = (name: string) => headers.find(h => h.name === name)?.value ?? '';
      const { name: fromName, email: from } = parseFrom(getHeader('From'));

      return {
        id:       msg.id       ?? '',
        threadId: msg.threadId ?? '',
        from,
        fromName,
        to:      getHeader('To'),
        subject: getHeader('Subject') || '(Sin asunto)',
        snippet: msg.snippet ?? '',
        body:    '',
        date:    getHeader('Date'),
        unread:  (msg.labelIds ?? []).includes('UNREAD'),
      } satisfies GmailMessage;
    })
  );

  return messages;
}

export async function getEmailBody(messageId: string): Promise<string> {
  const auth  = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const { data: msg } = await gmail.users.messages.get({
    userId: 'me',
    id:     messageId,
    format: 'full',
  });

  // Busca text/plain recursivamente en las partes del mensaje
  function extractText(parts: any[]): string {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.parts) {
        const nested = extractText(part.parts);
        if (nested) return nested;
      }
    }
    return '';
  }

  const parts = msg.payload?.parts ?? [];
  const body  = parts.length ? extractText(parts) : (
    msg.payload?.body?.data
      ? Buffer.from(msg.payload.body.data, 'base64url').toString('utf-8')
      : ''
  );

  return body || msg.snippet || '';
}

export async function markAsRead(messageId: string): Promise<void> {
  const auth  = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.modify({
    userId: 'me',
    id:     messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}

export async function createDraft(to: string, subject: string, body: string): Promise<{ draftId: string }> {
  const auth  = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
  ].join('\r\n');

  const { data } = await gmail.users.drafts.create({
    userId:      'me',
    requestBody: { message: { raw: Buffer.from(raw).toString('base64url') } },
  });

  return { draftId: data.id ?? '' };
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const auth  = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
  ].join('\r\n');

  await gmail.users.messages.send({
    userId:      'me',
    requestBody: { raw: Buffer.from(raw).toString('base64url') },
  });
}

export async function sendDraft(draftId: string): Promise<void> {
  const auth  = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.drafts.send({
    userId:      'me',
    requestBody: { id: draftId },
  });
}

export function formatEmailsForSpeech(emails: GmailMessage[]): string {
  if (!emails.length) return 'No tiene correos sin leer en la bandeja de entrada.';

  const count = emails.length;
  const lista = emails.slice(0, 5).map((e, i) => {
    const nombre = e.fromName && e.fromName !== e.from ? e.fromName : e.from;
    return `${i + 1}: de ${nombre}, asunto "${e.subject}"`;
  }).join('. ');

  return `Tiene ${count} correo${count !== 1 ? 's' : ''} sin leer. ${lista}.`;
}

export function formatEmailsForText(emails: GmailMessage[]): string {
  if (!emails.length) return '📭 *Bandeja limpia* — no tiene correos sin leer.';

  const lines = emails.map((e, i) => {
    const nombre = e.fromName && e.fromName !== e.from ? e.fromName : e.from;
    const fecha  = formatRelativeDate(e.date);
    return `${i + 1}. *${e.subject}*\n   De: ${nombre} · ${fecha}\n   _${e.snippet.slice(0, 100)}${e.snippet.length > 100 ? '…' : ''}_`;
  });

  return `📬 *${emails.length} correo${emails.length !== 1 ? 's' : ''} sin leer*\n\n${lines.join('\n\n')}`;
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now  = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffH  = diffMs / 3_600_000;
    if (diffH < 1)  return 'hace menos de 1h';
    if (diffH < 24) return `hace ${Math.floor(diffH)}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return 'ayer';
    if (diffD < 7)  return `hace ${diffD} días`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}
