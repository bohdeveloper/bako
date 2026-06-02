import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { exec } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import * as os from 'os';

const VOICE      = process.env.TTS_VOICE ?? 'es-ES-AlvaroNeural';
const AUDIO_FILE = path.join(os.tmpdir(), 'bako_speech.mp3');

let _ttsPromise: Promise<MsEdgeTTS> | null = null;

async function getTTS(): Promise<MsEdgeTTS> {
  if (!_ttsPromise) {
    _ttsPromise = (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
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
      await tts.setMetadata(VOICE, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
      return tts;
    })();
  }
  return _ttsOggPromise;
}

export async function generateVoiceBuffer(text: string): Promise<Buffer> {
  const tts = await getTTSOgg();
  const { audioStream } = await tts.toStream(text);
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}
