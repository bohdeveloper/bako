import webpush from 'web-push';
import { PushSubscription } from '../memory/PushSubscription';

let vapidConfigured = false;

// Convierte a base64url sin padding (requerido por web-push)
function toBase64url(key: string): string {
  return key.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function ensureVapid() {
  if (vapidConfigured) return;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return;
  webpush.setVapidDetails(
    `mailto:${process.env.ADMIN_EMAIL || 'bako@local.dev'}`,
    toBase64url(pub),
    toBase64url(priv)
  );
  vapidConfigured = true;
}

export async function sendPushToAll(text: string, voiceText?: string): Promise<void> {
  ensureVapid();
  if (!vapidConfigured) return;

  let subs: any[];
  try {
    subs = await PushSubscription.find().lean();
  } catch {
    return;
  }
  if (subs.length === 0) return;

  const payload = JSON.stringify({ text, voiceText: voiceText ?? text });

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => {});
        }
      }
    })
  );
}
