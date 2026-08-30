import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { exec } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import * as os from 'os';
import { AutoConfig } from '../memory/AutoConfig';

export function cleanForVoice(text: string): string {
  return text
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[_~|>`]/g, '')
    .replace(/\*/g, '');
}

export const VOCES_DISPONIBLES: Record<string, { id: string; descripcion: string }> = {
  alvaro:  { id: 'es-ES-AlvaroNeural',   descripcion: 'Álvaro — hombre, España (actual)' },
  elvira:  { id: 'es-ES-ElviraNeural',   descripcion: 'Elvira — mujer, España' },
  jorge:   { id: 'es-MX-JorgeNeural',    descripcion: 'Jorge — hombre, México' },
  dalia:   { id: 'es-MX-DaliaNeural',    descripcion: 'Dalia — mujer, México' },
  tomas:   { id: 'es-AR-TomasNeural',    descripcion: 'Tomás — hombre, Argentina' },
  elena:   { id: 'es-AR-ElenaNeural',    descripcion: 'Elena — mujer, Argentina' },
};

// Persistida en Mongo (colección AutoConfig, key "tts_voice") en vez de en memoria
// del proceso — antes se resetaba a Álvaro en cada reinicio de Render.
const VOICE_CONFIG_KEY = 'tts_voice';
const DEFAULT_VOICE_KEY = process.env.TTS_VOICE_KEY ?? 'alvaro';

let voiceCache: { key: string; ts: number } | null = null;
const VOICE_CACHE_TTL_MS = 30_000;

async function loadVoiceKey(): Promise<string> {
  if (voiceCache && Date.now() - voiceCache.ts < VOICE_CACHE_TTL_MS) return voiceCache.key;
  let cfg: { value?: string } | null = null;
  try {
    cfg = await AutoConfig.findOne({ key: VOICE_CONFIG_KEY }).lean();
  } catch (err) {
    // No cachear el fallback en un fallo transitorio de Mongo — si no, la voz
    // real (p.ej. "elena") queda tapada por "alvaro" hasta 30s sin que se note.
    console.warn('⚠️  tts: no se pudo leer la voz persistida, usando la última conocida o el defecto:', (err as Error).message);
    return voiceCache?.key ?? DEFAULT_VOICE_KEY;
  }
  const key = cfg?.value && VOCES_DISPONIBLES[cfg.value] ? cfg.value : DEFAULT_VOICE_KEY;
  voiceCache = { key, ts: Date.now() };
  return key;
}

export async function getCurrentVoiceKey(): Promise<string> {
  return loadVoiceKey();
}

export async function setVoice(key: string): Promise<boolean> {
  if (!VOCES_DISPONIBLES[key]) return false;
  await AutoConfig.findOneAndUpdate(
    { key: VOICE_CONFIG_KEY },
    { value: key, enabled: true },
    { upsert: true }
  );
  voiceCache     = { key, ts: Date.now() };
  _ttsOggPromise = null; // forzar reinicio con nueva voz
  _ttsPromise    = null;
  return true;
}

async function getVoiceId(): Promise<string> {
  const key = await loadVoiceKey();
  return VOCES_DISPONIBLES[key]?.id ?? 'es-ES-AlvaroNeural';
}

const AUDIO_FILE = path.join(os.tmpdir(), 'bako_speech.mp3');

let _ttsPromise: Promise<MsEdgeTTS> | null = null;

async function getTTS(): Promise<MsEdgeTTS> {
  if (!_ttsPromise) {
    _ttsPromise = (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(await getVoiceId(), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      return tts;
    })();
  }
  return _ttsPromise;
}

async function generateAudio(text: string): Promise<void> {
  const tts = await getTTS();
  const { audioStream } = await tts.toStream(text);
  const file = createWriteStream(AUDIO_FILE);
  await pipeline(audioStream, file);
}

function playAudio(): Promise<void> {
  return new Promise((resolve) => {
    const filePath = AUDIO_FILE.replace(/\\/g, '/');
    const ps = [
      "[System.Reflection.Assembly]::LoadWithPartialName('presentationCore') | Out-Null",
      `$p = New-Object System.Windows.Media.MediaPlayer`,
      `$p.Open([Uri]'file:///${filePath}')`,
      `$p.Play()`,
      `Start-Sleep -Seconds 1`,
      `while($p.NaturalDuration.HasTimeSpan -and ($p.Position -lt $p.NaturalDuration.TimeSpan)){Start-Sleep -Milliseconds 200}`,
      `$p.Stop(); $p.Close()`,
    ].join('; ');

    exec(`powershell -NonInteractive -c "${ps}"`, (err) => {
      if (err) console.warn('⚠️  Playback error:', err.message);
      resolve();
    });
  });
}

export async function speak(text: string): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('🔊 TTS local no disponible fuera de Windows');
    return;
  }
  await generateAudio(text);
  await playAudio();
}

export function stopSpeaking(): void {
  exec('powershell -c "Get-Process -Name wmplayer -ErrorAction SilentlyContinue | Stop-Process"');
}

// Genera audio OGG/Opus para enviar como nota de voz en Telegram
let _ttsOggPromise: Promise<MsEdgeTTS> | null = null;

async function getTTSOgg(): Promise<MsEdgeTTS> {
  if (!_ttsOggPromise) {
    _ttsOggPromise = (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(await getVoiceId(), OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
      return tts;
    })();
  }
  return _ttsOggPromise;
}

// Divide texto en fragmentos de máx ~900 chars cortando en límites de oración.
// msedge-tts puede cortar el audio silenciosamente en textos muy largos.
function splitForTTS(text: string, maxChars = 900): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf('. ', maxChars);
    if (cut < 200) cut = remaining.lastIndexOf(' ', maxChars);
    if (cut < 1) cut = maxChars;
    parts.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export async function generateVoiceBuffer(text: string): Promise<Buffer> {
  const tts    = await getTTSOgg();
  const parts  = splitForTTS(text);
  const buffers: Buffer[] = [];

  for (const part of parts) {
    const { audioStream } = await tts.toStream(part);
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      audioStream.on('data', (c: Buffer) => chunks.push(c));
      audioStream.on('end', () => resolve(Buffer.concat(chunks)));
      audioStream.on('error', reject);
    });
    buffers.push(buf);
  }

  return Buffer.concat(buffers);
}
