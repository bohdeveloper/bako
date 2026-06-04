#!/usr/bin/env python3
"""
BAKO Desktop v2 — GUI con revisión de transcripción y gestión de rate limit.

Flujo de voz:
  1. Mantén Ctrl+Alt+B (o el botón) → graba audio
  2. Al soltar → transcripción se muestra para revisión
  3. En 5s se envía automáticamente, o edita el texto y pulsa Enviar
  4. BAKO responde por texto y voz

Instalación:
  pip install -r requirements.txt
"""

import os, sys, time, tempfile, threading, wave, base64, re
import tkinter as tk
from tkinter import scrolledtext, font as tkfont
import requests

try:
    import sounddevice as sd
    import numpy as np
except ImportError:
    print("❌ pip install sounddevice numpy")
    sys.exit(1)

try:
    import pygame
    pygame.mixer.init(frequency=22050, size=-16, channels=1, buffer=512)
    PLAYER = 'pygame'
except ImportError:
    PLAYER = 'system'

try:
    import keyboard
    HAS_KEYBOARD = True
except ImportError:
    HAS_KEYBOARD = False

# ── Configuración ──────────────────────────────────────────────────────────────
BAKO_URL        = os.getenv('BAKO_URL',      'https://ai-personal-os.onrender.com')
DESKTOP_TOKEN   = os.getenv('DESKTOP_TOKEN', '')
HOTKEY          = os.getenv('BAKO_HOTKEY',   'ctrl+alt+b')
SAMPLE_RATE     = 16000
CHANNELS        = 1
MAX_DURATION    = 15
REVIEW_TIMEOUT  = 5   # segundos de espera antes de auto-enviar la transcripción
MIN_REQUEST_GAP = 3   # segundos mínimos entre peticiones al servidor

# ── Paleta de colores ──────────────────────────────────────────────────────────
BG       = '#0d1117'
BG2      = '#161b22'
BG3      = '#1c2128'
ACCENT   = '#38bdf8'
GREEN    = '#34d399'
BLUE     = '#60a5fa'
TEXT     = '#e6edf3'
DIM      = '#8b949e'
BTN      = '#21262d'
DANGER   = '#f87171'
WARNING  = '#fbbf24'


class BakoDesktopApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("BAKO Desktop")
        self.root.geometry("500x660")
        self.root.configure(bg=BG)
        self.root.resizable(True, True)
        self.root.minsize(400, 500)

        # ── Estado ────────────────────────────────────────────────────────────
        self.is_recording       = False
        self.audio_frames: list = []
        self.lock               = threading.Lock()
        self.last_request_time  = 0.0
        self.cooldown_until     = 0.0
        self.pending_text       = None          # transcripción pendiente de revisión
        self.countdown_job      = None          # after() id del tick
        self.countdown_val      = REVIEW_TIMEOUT
        self._placeholder_text  = "Escribe un mensaje..."

        self._build_fonts()
        self._build_ui()
        self._setup_hotkey()
        self._set_status("✅ Listo")

    # ─────────────────────────────────────────────────────────────────────────
    # UI
    # ─────────────────────────────────────────────────────────────────────────

    def _build_fonts(self):
        self.f_normal = tkfont.Font(family="Segoe UI", size=10)
        self.f_bold   = tkfont.Font(family="Segoe UI", size=10, weight="bold")
        self.f_small  = tkfont.Font(family="Segoe UI", size=8)
        self.f_title  = tkfont.Font(family="Segoe UI", size=11, weight="bold")

    def _build_ui(self):
        # ── Cabecera ──────────────────────────────────────────────────────────
        hdr = tk.Frame(self.root, bg=BG2, height=44)
        hdr.pack(fill='x', side='top')
        hdr.pack_propagate(False)

        self._dot = tk.Label(hdr, text="●", fg=GREEN, bg=BG2, font=("Segoe UI", 11))
        self._dot.pack(side='left', padx=(12, 4), pady=10)
        tk.Label(hdr, text="BAKO Desktop", fg=TEXT, bg=BG2, font=self.f_title).pack(side='left')
        self._hdr_status = tk.Label(hdr, text="", fg=DIM, bg=BG2, font=self.f_small)
        self._hdr_status.pack(side='right', padx=12)

        # ── Historial de chat ─────────────────────────────────────────────────
        self.chat = scrolledtext.ScrolledText(
            self.root, bg=BG, fg=TEXT, font=self.f_normal,
            wrap=tk.WORD, state='disabled', relief='flat',
            padx=14, pady=10, spacing1=1, spacing3=8,
            insertbackground=TEXT, selectbackground='#264f78',
        )
        self.chat.pack(fill='both', expand=True)
        self.chat.tag_config('bako',   foreground=BLUE)
        self.chat.tag_config('user',   foreground=GREEN)
        self.chat.tag_config('label',  foreground=DIM, font=self.f_small)
        self.chat.tag_config('warn',   foreground=WARNING, font=self.f_small)
        self.chat.tag_config('err',    foreground=DANGER, font=self.f_small)

        # ── Panel inferior (preview + input) ──────────────────────────────────
        self._bottom = tk.Frame(self.root, bg=BG2)
        self._bottom.pack(fill='x', side='bottom')
        self._bottom.columnconfigure(0, weight=1)

        # Fila 0: panel de revisión (oculto hasta que haya transcripción)
        self._preview_panel = tk.Frame(self._bottom, bg=BG3, pady=6)
        self._preview_panel.grid(row=0, column=0, sticky='ew')
        self._preview_panel.grid_remove()

        prev_top = tk.Frame(self._preview_panel, bg=BG3)
        prev_top.pack(fill='x', padx=10)
        tk.Label(prev_top, text="📝 Transcripción:", fg=DIM, bg=BG3,
                 font=self.f_small).pack(side='left')
        self._countdown_lbl = tk.Label(prev_top, text="", fg=WARNING, bg=BG3,
                                       font=self.f_small)
        self._countdown_lbl.pack(side='right')

        self._preview_var = tk.StringVar()
        self._preview_entry = tk.Entry(
            self._preview_panel, textvariable=self._preview_var,
            bg=BG2, fg=TEXT, font=self.f_normal, relief='flat',
            insertbackground=TEXT, highlightthickness=1,
            highlightcolor=ACCENT, highlightbackground=BG3,
        )
        self._preview_entry.pack(fill='x', padx=10, pady=(4, 4), ipady=5)
        self._preview_entry.bind('<KeyRelease>', self._on_preview_edit)
        self._preview_entry.bind('<Return>', lambda _: self._send_preview())

        prev_btns = tk.Frame(self._preview_panel, bg=BG3)
        prev_btns.pack(fill='x', padx=10, pady=(0, 4))
        tk.Button(prev_btns, text="✕ Cancelar", command=self._cancel_preview,
                  bg=BTN, fg=DANGER, relief='flat', font=self.f_small,
                  padx=8, pady=3, cursor='hand2').pack(side='left')
        self._prev_send_btn = tk.Button(
            prev_btns, text="➤ Enviar", command=self._send_preview,
            bg=ACCENT, fg=BG, relief='flat', font=self.f_bold,
            padx=12, pady=3, cursor='hand2',
        )
        self._prev_send_btn.pack(side='right')

        # Separador
        tk.Frame(self._bottom, bg='#21262d', height=1).grid(row=1, column=0, sticky='ew')

        # Fila 2: input de texto
        input_row = tk.Frame(self._bottom, bg=BG2, pady=8)
        input_row.grid(row=2, column=0, sticky='ew')
        input_row.columnconfigure(0, weight=1)

        txt_frame = tk.Frame(input_row, bg=BG2)
        txt_frame.pack(fill='x', padx=10, pady=(0, 6))
        txt_frame.columnconfigure(0, weight=1)

        self._text_entry = tk.Entry(
            txt_frame, bg=BG3, fg=DIM, font=self.f_normal,
            relief='flat', insertbackground=TEXT,
            highlightthickness=1, highlightcolor=ACCENT, highlightbackground=BG3,
        )
        self._text_entry.insert(0, self._placeholder_text)
        self._text_entry.grid(row=0, column=0, sticky='ew', ipady=6)
        self._text_entry.bind('<FocusIn>',    self._ph_focus_in)
        self._text_entry.bind('<FocusOut>',   self._ph_focus_out)
        self._text_entry.bind('<Return>',     lambda _: self._send_text_input())

        self._send_btn = tk.Button(
            txt_frame, text="➤", command=self._send_text_input,
            bg=ACCENT, fg=BG, relief='flat', font=self.f_bold,
            width=3, pady=4, cursor='hand2',
        )
        self._send_btn.grid(row=0, column=1, padx=(6, 0))

        # Botón de micrófono
        self._mic_btn = tk.Button(
            input_row,
            text=f"🎤  Mantén para hablar  ({HOTKEY.upper()})",
            bg=BTN, fg=TEXT, relief='flat', font=self.f_normal,
            pady=8, cursor='hand2', activebackground='#1a3a1a',
        )
        self._mic_btn.pack(fill='x', padx=10)
        self._mic_btn.bind('<ButtonPress-1>',   self._on_mic_press)
        self._mic_btn.bind('<ButtonRelease-1>', self._on_mic_release)

        # Barra de estado
        self._status_bar = tk.Label(
            input_row, text="", fg=DIM, bg=BG2, font=self.f_small, anchor='w',
        )
        self._status_bar.pack(fill='x', padx=12, pady=(4, 2))

    # ─────────────────────────────────────────────────────────────────────────
    # Placeholder helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _ph_focus_in(self, event):
        if self._text_entry.get() == self._placeholder_text:
            self._text_entry.delete(0, tk.END)
            self._text_entry.config(fg=TEXT)

    def _ph_focus_out(self, event):
        if not self._text_entry.get():
            self._text_entry.insert(0, self._placeholder_text)
            self._text_entry.config(fg=DIM)

    # ─────────────────────────────────────────────────────────────────────────
    # Helpers de estado
    # ─────────────────────────────────────────────────────────────────────────

    def _set_status(self, msg: str, color: str = DIM):
        self.root.after(0, lambda: self._status_bar.config(text=msg, fg=color))

    def _set_dot(self, color: str):
        self.root.after(0, lambda: self._dot.config(fg=color))

    def _set_ui_enabled(self, enabled: bool):
        state = 'normal' if enabled else 'disabled'
        def _do():
            self._mic_btn.config(state=state)
            self._send_btn.config(state=state)
            self._prev_send_btn.config(state=state)
        self.root.after(0, _do)

    # ─────────────────────────────────────────────────────────────────────────
    # Historial de chat
    # ─────────────────────────────────────────────────────────────────────────

    def _chat_append(self, label: str, body: str, body_tag: str = ''):
        def _do():
            self.chat.config(state='normal')
            if label:
                self.chat.insert(tk.END, label + '\n', 'label')
            tags = (body_tag,) if body_tag else ()
            self.chat.insert(tk.END, body + '\n\n', tags)
            self.chat.config(state='disabled')
            self.chat.see(tk.END)
        self.root.after(0, _do)

    def msg_user(self, text: str):
        self._chat_append("👤 Tú:", text, 'user')

    def msg_bako(self, text: str):
        self._chat_append("🤖 BAKO:", text, 'bako')

    def msg_warn(self, text: str):
        self._chat_append("", f"⚠️ {text}", 'warn')

    def msg_err(self, text: str):
        self._chat_append("", f"❌ {text}", 'err')

    # ─────────────────────────────────────────────────────────────────────────
    # Rate limit / cooldown
    # ─────────────────────────────────────────────────────────────────────────

    def _cooling_down(self) -> bool:
        return time.time() < self.cooldown_until

    def _set_cooldown(self, seconds: int):
        self.cooldown_until = time.time() + seconds
        self._set_ui_enabled(False)
        self._tick_cooldown()

    def _tick_cooldown(self):
        remaining = int(self.cooldown_until - time.time())
        if remaining > 0:
            self._set_status(f"⏳ Rate limit — disponible en {remaining}s", WARNING)
            self._hdr_status.config(text=f"espera {remaining}s", fg=WARNING)
            self.root.after(1000, self._tick_cooldown)
        else:
            self._set_ui_enabled(True)
            self._set_status("✅ Listo")
            self.root.after(0, lambda: self._hdr_status.config(text="", fg=DIM))

    def _min_gap_ok(self) -> bool:
        return (time.time() - self.last_request_time) >= MIN_REQUEST_GAP

    def _wait_gap_if_needed(self):
        gap = time.time() - self.last_request_time
        if gap < MIN_REQUEST_GAP:
            remaining = MIN_REQUEST_GAP - gap
            self._set_status(f"⏳ Espera {remaining:.1f}s...", WARNING)
            time.sleep(remaining)

    @staticmethod
    def _parse_cooldown_secs(text: str) -> int:
        m = re.search(r'(\d+)\s*(?:s\b|sec|second|segundo)', text, re.I)
        if m:
            return min(int(m.group(1)), 120)
        return 30

    # ─────────────────────────────────────────────────────────────────────────
    # Grabación de audio
    # ─────────────────────────────────────────────────────────────────────────

    def _on_mic_press(self, event=None):
        if self._cooling_down() or self.is_recording:
            return
        with self.lock:
            self.is_recording = True
            self.audio_frames = []
        self.root.after(0, lambda: self._mic_btn.config(
            bg='#0d2b0d', text="🔴  Grabando... (suelta para enviar)", fg=GREEN))
        self._set_status("🎤 Escuchando...", GREEN)
        threading.Thread(target=self._record_loop, daemon=True).start()

    def _on_mic_release(self, event=None):
        with self.lock:
            self.is_recording = False
        self.root.after(0, lambda: self._mic_btn.config(
            bg=BTN, text=f"🎤  Mantén para hablar  ({HOTKEY.upper()})", fg=TEXT))

    def _record_loop(self):
        def callback(indata, frames, t, status):
            with self.lock:
                if not self.is_recording:
                    raise sd.CallbackAbort
                self.audio_frames.append(indata.copy())

        try:
            with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                                dtype='int16', blocksize=1024, callback=callback):
                start = time.time()
                while True:
                    with self.lock:
                        if not self.is_recording:
                            break
                    if time.time() - start >= MAX_DURATION:
                        with self.lock:
                            self.is_recording = False
                        break
                    time.sleep(0.05)
        except Exception:
            pass

        frames = self.audio_frames
        if not frames:
            self._set_status("✅ Listo")
            return

        self._set_status("🔄 Transcribiendo...", ACCENT)
        threading.Thread(target=self._transcribe, args=(frames,), daemon=True).start()

    # ─────────────────────────────────────────────────────────────────────────
    # Transcripción → preview
    # ─────────────────────────────────────────────────────────────────────────

    def _transcribe(self, frames):
        try:
            audio_data = np.concatenate(frames, axis=0)
            tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            with wave.open(tmp.name, 'wb') as wf:
                wf.setnchannels(CHANNELS)
                wf.setsampwidth(2)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(audio_data.tobytes())
            tmp.close()

            headers = {'x-desktop-token': DESKTOP_TOKEN} if DESKTOP_TOKEN else {}
            with open(tmp.name, 'rb') as f:
                resp = requests.post(
                    f'{BAKO_URL}/api/desktop/transcribe',
                    headers=headers,
                    files={'audio': ('voice.wav', f, 'audio/wav')},
                    timeout=20,
                )
            os.unlink(tmp.name)

            if resp.status_code != 200:
                self.msg_err(f"Transcripción fallida ({resp.status_code})")
                self._set_status("✅ Listo")
                return

            text = resp.json().get('transcription', '').strip()
            if not text:
                self.msg_warn("No se detectó habla")
                self._set_status("✅ Listo")
                return

            self._show_preview(text)

        except requests.exceptions.ConnectionError:
            self.msg_err("Sin conexión con BAKO")
            self._set_status("✅ Listo")
        except Exception as e:
            self.msg_err(str(e))
            self._set_status("✅ Listo")

    def _show_preview(self, text: str):
        self.pending_text    = text
        self.countdown_val   = REVIEW_TIMEOUT

        def _do():
            self._preview_var.set(text)
            self._preview_panel.grid()          # muestra el panel
            self._preview_entry.focus_set()
            self._preview_entry.icursor(tk.END)
            self._set_status(f"📝 Edita o espera {REVIEW_TIMEOUT}s para enviar", ACCENT)
        self.root.after(0, _do)
        self._start_countdown()

    def _start_countdown(self):
        if self.countdown_job:
            self.root.after_cancel(self.countdown_job)
        self.countdown_val = REVIEW_TIMEOUT
        self._tick_countdown_preview()

    def _tick_countdown_preview(self):
        if self.pending_text is None:
            return
        if self.countdown_val <= 0:
            self._send_preview()
            return
        self._countdown_lbl.config(text=f"Enviando en {self.countdown_val}s…")
        self.countdown_val -= 1
        self.countdown_job = self.root.after(1000, self._tick_countdown_preview)

    def _on_preview_edit(self, event=None):
        # Detiene el countdown cuando el usuario edita
        if self.countdown_job:
            self.root.after_cancel(self.countdown_job)
            self.countdown_job = None
        self._countdown_lbl.config(text="Listo para enviar")
        self._set_status("✏️ Editado — pulsa Enviar o Enter", ACCENT)

    def _send_preview(self):
        text = self._preview_var.get().strip()
        self._cancel_preview()
        if text:
            threading.Thread(target=self._send_and_display, args=(text,), daemon=True).start()

    def _cancel_preview(self):
        if self.countdown_job:
            self.root.after_cancel(self.countdown_job)
            self.countdown_job = None
        self.pending_text = None
        def _do():
            self._preview_panel.grid_remove()
            self._set_status("✅ Listo")
        self.root.after(0, _do)

    # ─────────────────────────────────────────────────────────────────────────
    # Input de texto
    # ─────────────────────────────────────────────────────────────────────────

    def _send_text_input(self):
        text = self._text_entry.get().strip()
        if not text or text == self._placeholder_text:
            return
        if self._cooling_down():
            self.msg_warn("Rate limit activo — espera antes de enviar.")
            return
        self._text_entry.delete(0, tk.END)
        self._text_entry.config(fg=DIM)
        self._text_entry.insert(0, self._placeholder_text)
        threading.Thread(target=self._send_and_display, args=(text,), daemon=True).start()

    # ─────────────────────────────────────────────────────────────────────────
    # Envío a BAKO
    # ─────────────────────────────────────────────────────────────────────────

    def _send_and_display(self, text: str):
        if self._cooling_down():
            self.msg_warn("Rate limit activo — espera antes de enviar.")
            return

        self._wait_gap_if_needed()

        self.msg_user(text)
        self._set_status("📡 Enviando a BAKO...", ACCENT)
        self._set_ui_enabled(False)

        try:
            headers = {'Content-Type': 'application/json'}
            if DESKTOP_TOKEN:
                headers['x-desktop-token'] = DESKTOP_TOKEN

            resp = requests.post(
                f'{BAKO_URL}/api/desktop/text',
                json={'message': text},
                headers=headers,
                timeout=45,
            )
            self.last_request_time = time.time()
            data = resp.json()

            # ── Rate limit ────────────────────────────────────────────────────
            body_str = str(data).lower()
            is_rate_limit = (
                resp.status_code == 429 or
                (resp.status_code >= 400 and
                 any(kw in body_str for kw in ['rate_limit', 'rate limit', '429', 'límite', 'limit']))
            )
            if is_rate_limit:
                secs = self._parse_cooldown_secs(str(data))
                self._set_cooldown(secs)
                self.msg_err(f"Rate limit — próximo mensaje en {secs}s")
                return

            if resp.status_code >= 400:
                self.msg_err(data.get('error', f'Error {resp.status_code}'))
                self._set_ui_enabled(True)
                self._set_status("✅ Listo")
                return

            response_text = data.get('response', '')
            if response_text:
                self.msg_bako(response_text)

            if 'audio' in data:
                self._set_status("🔊 Reproduciendo...", ACCENT)
                threading.Thread(target=self._play_audio, args=(data['audio'],), daemon=True).start()

            self._set_ui_enabled(True)
            self._set_status("✅ Listo")

        except requests.exceptions.ConnectionError:
            self.msg_err("Sin conexión con BAKO. ¿Está activo el servidor?")
            self._set_ui_enabled(True)
            self._set_status("⚠️ Sin conexión", DANGER)
        except requests.exceptions.Timeout:
            self.msg_err("Timeout — BAKO tardó demasiado en responder")
            self._set_ui_enabled(True)
            self._set_status("✅ Listo")
        except Exception as e:
            self.msg_err(str(e))
            self._set_ui_enabled(True)
            self._set_status("✅ Listo")

    # ─────────────────────────────────────────────────────────────────────────
    # Reproducción de audio
    # ─────────────────────────────────────────────────────────────────────────

    def _play_audio(self, audio_b64: str):
        audio_bytes = base64.b64decode(audio_b64)
        tmp = tempfile.NamedTemporaryFile(suffix='.webm', delete=False)
        tmp.write(audio_bytes)
        tmp.flush()
        tmp.close()
        try:
            if PLAYER == 'pygame':
                pygame.mixer.music.load(tmp.name)
                pygame.mixer.music.play()
                while pygame.mixer.music.get_busy():
                    time.sleep(0.1)
            else:
                import subprocess
                if sys.platform == 'win32':
                    os.startfile(tmp.name)
                    time.sleep(3)
                elif sys.platform == 'darwin':
                    subprocess.run(['afplay', tmp.name])
                else:
                    subprocess.run(['aplay', tmp.name])
        finally:
            try:
                os.unlink(tmp.name)
            except Exception:
                pass

    # ─────────────────────────────────────────────────────────────────────────
    # Hotkey global
    # ─────────────────────────────────────────────────────────────────────────

    def _setup_hotkey(self):
        if not HAS_KEYBOARD:
            return
        try:
            parts  = HOTKEY.lower().split('+')
            trigger = parts[-1]
            mods    = parts[:-1]
            keyboard.on_press_key(
                trigger,
                lambda _: self.root.after(0, self._on_mic_press) if self._mods_ok(mods) else None,
            )
            keyboard.on_release_key(
                trigger,
                lambda _: self.root.after(0, self._on_mic_release),
            )
        except Exception as e:
            print(f"⚠️  Hotkey no disponible: {e}")

    def _mods_ok(self, mods) -> bool:
        if 'ctrl'  in mods and not keyboard.is_pressed('ctrl'):  return False
        if 'alt'   in mods and not keyboard.is_pressed('alt'):   return False
        if 'shift' in mods and not keyboard.is_pressed('shift'): return False
        return True


# ── Punto de entrada ───────────────────────────────────────────────────────────

def main():
    root = tk.Tk()
    root.tk_setPalette(background=BG, foreground=TEXT)

    # Icono (opcional — ignorar si no existe)
    try:
        icon_path = os.path.join(os.path.dirname(__file__), 'icon.ico')
        if os.path.exists(icon_path):
            root.iconbitmap(icon_path)
    except Exception:
        pass

    app = BakoDesktopApp(root)

    # Mensaje de bienvenida en el chat
    app._chat_append("", f"BAKO Desktop v2  ·  {BAKO_URL}\nHotkey: {HOTKEY.upper()}\n", 'label')

    root.mainloop()


if __name__ == '__main__':
    main()
