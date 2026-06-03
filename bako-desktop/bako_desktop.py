#!/usr/bin/env python3
"""
BAKO Desktop — Cliente de escritorio para Windows/Mac/Linux
Mantén Ctrl+Alt+B para hablar con BAKO. Suelta para enviar.
BAKO responde por los altavoces.

Instalación:
  pip install -r requirements.txt

Uso:
  python bako_desktop.py

Variables de entorno opcionales:
  BAKO_URL          URL del backend (default: https://bako-backend.onrender.com)
  DESKTOP_TOKEN     Token si configuraste DESKTOP_TOKEN en el servidor
  BAKO_HOTKEY       Atajo de teclado (default: ctrl+alt+b)
"""

import os, sys, time, tempfile, threading, wave, struct
import requests
import keyboard

try:
    import sounddevice as sd
    import numpy as np
except ImportError:
    print("❌ Faltan dependencias. Ejecuta: pip install -r requirements.txt")
    sys.exit(1)

try:
    import pygame
    pygame.mixer.init(frequency=22050, size=-16, channels=1, buffer=512)
    PLAYER = 'pygame'
except ImportError:
    PLAYER = 'system'

# ─── Configuración ────────────────────────────────────────────────────────────

BAKO_URL      = os.getenv('BAKO_URL', 'https://bako-backend.onrender.com')
DESKTOP_TOKEN = os.getenv('DESKTOP_TOKEN', '')
HOTKEY        = os.getenv('BAKO_HOTKEY', 'ctrl+alt+b')
SAMPLE_RATE   = 16000
CHANNELS      = 1
SILENCE_SEC   = 1.5   # segundos de silencio para auto-cortar
SILENCE_THRESH= 500   # umbral de amplitud para detectar silencio
MAX_DURATION  = 15    # máximo de grabación en segundos

# ─── Estado ───────────────────────────────────────────────────────────────────

is_recording  = False
should_stop   = False
audio_frames  = []
lock          = threading.Lock()

# ─── Audio ────────────────────────────────────────────────────────────────────

def record_audio():
    """Graba mientras se mantiene la tecla. Devuelve bytes WAV."""
    global is_recording, should_stop, audio_frames

    with lock:
        is_recording  = True
        should_stop   = False
        audio_frames  = []

    print("🎤 Escuchando... (suelta Ctrl+Alt+B para enviar)")

    silence_count  = 0
    silence_thresh = int(SAMPLE_RATE * SILENCE_SEC / 1024)

    def callback(indata, frames, time_info, status):
        nonlocal silence_count
        with lock:
            if not is_recording:
                raise sd.CallbackAbort
            audio_frames.append(indata.copy())

        # Detección de silencio para auto-corte
        amplitude = np.max(np.abs(indata))
        if amplitude < SILENCE_THRESH:
            silence_count += 1
        else:
            silence_count = 0

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                        dtype='int16', blocksize=1024, callback=callback):
        start = time.time()
        while True:
            with lock:
                if not is_recording:
                    break
            if time.time() - start > MAX_DURATION:
                print("⏱ Límite de tiempo alcanzado")
                break
            time.sleep(0.05)

    with lock:
        is_recording = False

    if not audio_frames:
        return None

    audio_data = np.concatenate(audio_frames, axis=0)

    # Convertir a bytes WAV
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    with wave.open(tmp.name, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # int16 = 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data.tobytes())

    return tmp.name


def play_audio_base64(audio_b64: str):
    """Reproduce audio desde base64."""
    import base64
    audio_bytes = base64.b64decode(audio_b64)

    tmp = tempfile.NamedTemporaryFile(suffix='.webm', delete=False)
    tmp.write(audio_bytes)
    tmp.flush()
    tmp.close()

    if PLAYER == 'pygame':
        try:
            pygame.mixer.music.load(tmp.name)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                time.sleep(0.1)
        except Exception as e:
            print(f"⚠️  Error pygame: {e}. Intentando con sistema...")
            play_system(tmp.name)
    else:
        play_system(tmp.name)

    os.unlink(tmp.name)


def play_system(filepath: str):
    """Reproduce audio usando el reproductor del sistema."""
    import subprocess
    if sys.platform == 'win32':
        os.startfile(filepath)
        time.sleep(3)  # Esperar un momento antes de que se borre
    elif sys.platform == 'darwin':
        subprocess.run(['afplay', filepath])
    else:
        subprocess.run(['aplay', filepath])


# ─── API ──────────────────────────────────────────────────────────────────────

def send_to_bako(wav_path: str) -> dict:
    """Envía audio al endpoint de BAKO y obtiene respuesta."""
    headers = {}
    if DESKTOP_TOKEN:
        headers['x-desktop-token'] = DESKTOP_TOKEN

    with open(wav_path, 'rb') as f:
        files = {'audio': ('voice.wav', f, 'audio/wav')}
        response = requests.post(
            f'{BAKO_URL}/api/desktop/voice',
            headers=headers,
            files=files,
            timeout=30
        )

    response.raise_for_status()
    return response.json()


# ─── Flujo principal ──────────────────────────────────────────────────────────

def on_hotkey_press():
    global is_recording
    if not is_recording:
        threading.Thread(target=record_and_respond, daemon=True).start()


def on_hotkey_release():
    global is_recording
    with lock:
        is_recording = False


def record_and_respond():
    wav_path = None
    try:
        wav_path = record_audio()
        if not wav_path:
            print("⚠️  No se grabó audio")
            return

        print("📡 Enviando a BAKO...")
        data = send_to_bako(wav_path)

        if 'transcription' in data:
            print(f"\n🗣  Tú: {data['transcription']}")
        if 'response' in data:
            print(f"🤖 BAKO: {data['response']}\n")

        if 'audio' in data:
            print("🔊 Reproduciendo respuesta...")
            play_audio_base64(data['audio'])

    except requests.exceptions.ConnectionError:
        print("❌ No se pudo conectar con BAKO. ¿Está activo el servidor?")
    except requests.exceptions.Timeout:
        print("❌ Timeout. El servidor tardó demasiado.")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


# ─── Punto de entrada ─────────────────────────────────────────────────────────

def main():
    print(f"""
╔══════════════════════════════════════╗
║         BAKO Desktop v1.0            ║
╠══════════════════════════════════════╣
║  Hotkey : {HOTKEY:<27} ║
║  Servidor: {BAKO_URL[:29]:<29} ║
╚══════════════════════════════════════╝

✅ BAKO Desktop activo. Ctrl+C para salir.
    """)

    # Configurar hotkey — mantener presionado para grabar
    keyboard.on_press_key(HOTKEY.split('+')[-1],
        lambda _: on_hotkey_press() if _check_modifiers() else None)
    keyboard.on_release_key(HOTKEY.split('+')[-1],
        lambda _: on_hotkey_release())

    try:
        keyboard.wait()
    except KeyboardInterrupt:
        print("\n👋 BAKO Desktop cerrado.")


def _check_modifiers() -> bool:
    """Verifica que los modificadores del hotkey estén presionados."""
    parts = HOTKEY.lower().split('+')
    mods  = parts[:-1]
    if 'ctrl' in mods and not keyboard.is_pressed('ctrl'):
        return False
    if 'alt' in mods and not keyboard.is_pressed('alt'):
        return False
    if 'shift' in mods and not keyboard.is_pressed('shift'):
        return False
    return True


if __name__ == '__main__':
    main()
