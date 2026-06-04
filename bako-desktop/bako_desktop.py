#!/usr/bin/env python3
"""
BAKO Desktop v3 — GUI completa con chat, burbujas, modo claro/oscuro.

Características:
  - Chat history con burbujas (usuario derecha · BAKO izquierda)
  - Botón ↩ por mensaje → copia al input para editar y reenviar
  - Input de texto + botón Enviar
  - Modo claro/oscuro con toggle (persiste en ~/.bako_theme)
  - Revisión de transcripción: 5s countdown editable antes de enviar
  - Rate limit: bloquea UI con countdown hasta que expire
  - Hotkey global Ctrl+Alt+B para grabar

Instalación:
  pip install -r requirements.txt
"""

import os, sys, time, tempfile, threading, wave, base64, re, json
import tkinter as tk
from tkinter import font as tkfont
import requests

try:
    import sounddevice as sd
    import numpy as np
except ImportError:
    print("❌ pip install sounddevice numpy"); sys.exit(1)

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
REVIEW_TIMEOUT  = 5
MIN_REQUEST_GAP = 3
THEME_FILE      = os.path.join(os.path.expanduser('~'), '.bako_theme')

# ── Paletas de colores ─────────────────────────────────────────────────────────
THEMES = {
    'dark': {
        'bg':          '#0d1117',
        'bg2':         '#161b22',
        'bg3':         '#1c2128',
        'border':      '#30363d',
        'text':        '#e6edf3',
        'dim':         '#8b949e',
        'accent':      '#38bdf8',
        'green':       '#34d399',
        'yellow':      '#fbbf24',
        'red':         '#f87171',
        'btn':         '#21262d',
        'bako_bubble': '#0e1e32',
        'user_bubble': '#0d2b1a',
        'bako_text':   '#c8dff8',
        'user_text':   '#a8e6c8',
        'status_text': '#8b949e',
        'toggle_icon': '☀️',
    },
    'light': {
        'bg':          '#fdfefe',
        'bg2':         '#f0f2f4',
        'bg3':         '#e6e9ec',
        'border':      '#d0d4d8',
        'text':        '#1a1a1a',
        'dim':         '#888888',
        'accent':      '#0078d4',
        'green':       '#059669',
        'yellow':      '#d97706',
        'red':         '#dc2626',
        'btn':         '#e0e3e6',
        'bako_bubble': '#dbeafe',
        'user_bubble': '#d1fae5',
        'bako_text':   '#1e3a5f',
        'user_text':   '#1a3a28',
        'status_text': '#666666',
        'toggle_icon': '🌙',
    },
}


class BakoDesktopApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("BAKO Desktop")
        self.root.geometry("520x680")
        self.root.minsize(420, 520)

        # ── Estado ────────────────────────────────────────────────────────────
        self.is_recording      = False
        self.audio_frames      = []
        self.lock              = threading.Lock()
        self.last_request_time = 0.0
        self.cooldown_until    = 0.0
        self.pending_text      = None
        self.countdown_job     = None
        self.countdown_val     = REVIEW_TIMEOUT
        self.user_editing      = False
        self.messages          = []      # (role, text) history
        self.msg_widgets       = []      # (row, bubble, label, reuse_btn, role)

        # ── Tema ──────────────────────────────────────────────────────────────
        saved = 'dark'
        try:
            if os.path.exists(THEME_FILE):
                saved = open(THEME_FILE).read().strip()
        except Exception:
            pass
        self.theme_name = saved if saved in THEMES else 'dark'
        self.t = THEMES[self.theme_name]

        self._build_fonts()
        self._build_ui()
        self._setup_hotkey()
        self._add_message('bako', '¿En qué puedo ayudarle, señor?')
        self._set_status('✅ Listo')

    # ─────────────────────────────────────────────────────────────────────────
    # Fonts
    # ─────────────────────────────────────────────────────────────────────────

    def _build_fonts(self):
        self.f_normal = tkfont.Font(family='Segoe UI', size=10)
        self.f_bold   = tkfont.Font(family='Segoe UI', size=10, weight='bold')
        self.f_small  = tkfont.Font(family='Segoe UI', size=8)
        self.f_title  = tkfont.Font(family='Segoe UI', size=11, weight='bold')

    # ─────────────────────────────────────────────────────────────────────────
    # UI
    # ─────────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        t = self.t
        self.root.configure(bg=t['bg'])

        # Header
        self._hdr = tk.Frame(self.root, bg=t['bg2'], height=44)
        self._hdr.pack(fill='x', side='top')
        self._hdr.pack_propagate(False)

        tk.Label(self._hdr, text='BAKO', fg=t['text'], bg=t['bg2'],
                 font=self.f_title).pack(side='left', padx=(14, 4), pady=10)
        tk.Label(self._hdr, text='MAYORDOMO PERSONAL', fg=t['dim'], bg=t['bg2'],
                 font=self.f_small).pack(side='left')

        self._toggle_btn = tk.Button(
            self._hdr, text=t['toggle_icon'],
            bg=t['bg2'], fg=t['text'], relief='flat',
            font=tkfont.Font(size=14), cursor='hand2',
            command=self._toggle_theme,
        )
        self._toggle_btn.pack(side='right', padx=12)

        # Chat area (Canvas + Scrollbar)
        chat_outer = tk.Frame(self.root, bg=t['bg'])
        chat_outer.pack(fill='both', expand=True)

        self._chat_scrollbar = tk.Scrollbar(chat_outer, orient='vertical')
        self._chat_scrollbar.pack(side='right', fill='y')

        self._canvas = tk.Canvas(
            chat_outer, bg=t['bg'], highlightthickness=0,
            yscrollcommand=self._chat_scrollbar.set,
        )
        self._canvas.pack(side='left', fill='both', expand=True)
        self._chat_scrollbar.config(command=self._canvas.yview)

        self._chat_frame = tk.Frame(self._canvas, bg=t['bg'])
        self._canvas_window = self._canvas.create_window(
            (0, 0), window=self._chat_frame, anchor='nw',
        )

        self._chat_frame.bind('<Configure>', self._on_chat_configure)
        self._canvas.bind('<Configure>', self._on_canvas_configure)

        # Mousewheel scroll
        self._canvas.bind_all('<MouseWheel>', lambda e: self._canvas.yview_scroll(
            int(-1 * (e.delta / 120)), 'units'))

        # Bottom
        self._bottom = tk.Frame(self.root, bg=t['bg2'])
        self._bottom.pack(fill='x', side='bottom')

        # Preview panel (oculto inicialmente)
        self._preview_frame = tk.Frame(self._bottom, bg=t['bg3'], pady=6)

        prev_top = tk.Frame(self._preview_frame, bg=t['bg3'])
        prev_top.pack(fill='x', padx=10)
        tk.Label(prev_top, text='📝 Transcripción:', fg=t['dim'],
                 bg=t['bg3'], font=self.f_small).pack(side='left')
        self._countdown_lbl = tk.Label(prev_top, text='', fg=t['yellow'],
                                        bg=t['bg3'], font=self.f_small)
        self._countdown_lbl.pack(side='right')

        self._preview_var = tk.StringVar()
        self._preview_entry = tk.Entry(
            self._preview_frame, textvariable=self._preview_var,
            bg=t['bg2'], fg=t['text'], font=self.f_normal, relief='flat',
            insertbackground=t['text'],
        )
        self._preview_entry.pack(fill='x', padx=10, pady=(4, 4), ipady=5)
        self._preview_entry.bind('<KeyRelease>', self._on_preview_edit)
        self._preview_entry.bind('<Return>', lambda _: self._send_preview())

        prev_btns = tk.Frame(self._preview_frame, bg=t['bg3'])
        prev_btns.pack(fill='x', padx=10, pady=(0, 4))
        tk.Button(prev_btns, text='✕ Cancelar', command=self._cancel_preview,
                  bg=t['btn'], fg=t['red'], relief='flat', font=self.f_small,
                  padx=8, pady=2, cursor='hand2').pack(side='left')
        self._prev_send_btn = tk.Button(
            prev_btns, text='➤ Enviar', command=self._send_preview,
            bg=t['accent'], fg=t['bg'], relief='flat', font=self.f_bold,
            padx=12, pady=2, cursor='hand2',
        )
        self._prev_send_btn.pack(side='right')

        # Separator
        tk.Frame(self._bottom, bg=t['border'], height=1).pack(fill='x')

        # Text input row
        input_row = tk.Frame(self._bottom, bg=t['bg2'], pady=8)
        input_row.pack(fill='x')

        txt_frame = tk.Frame(input_row, bg=t['bg2'])
        txt_frame.pack(fill='x', padx=10, pady=(0, 6))
        txt_frame.columnconfigure(0, weight=1)

        self._text_entry = tk.Entry(
            txt_frame, bg=t['bg3'], fg=t['dim'], font=self.f_normal,
            relief='flat', insertbackground=t['text'],
        )
        self._text_entry.insert(0, 'Escribe un mensaje…')
        self._text_entry.grid(row=0, column=0, sticky='ew', ipady=6)
        self._text_entry.bind('<FocusIn>',  self._ph_in)
        self._text_entry.bind('<FocusOut>', self._ph_out)
        self._text_entry.bind('<Return>',   lambda _: self._send_text_input())

        self._send_btn = tk.Button(
            txt_frame, text='➤', command=self._send_text_input,
            bg=t['accent'], fg=t['bg'], relief='flat', font=self.f_bold,
            width=3, pady=4, cursor='hand2',
        )
        self._send_btn.grid(row=0, column=1, padx=(6, 0))

        # Mic button
        self._mic_btn = tk.Button(
            input_row,
            text=f'🎤  Mantén para hablar  ({HOTKEY.upper()})',
            bg=t['btn'], fg=t['text'], relief='flat', font=self.f_normal,
            pady=8, cursor='hand2',
        )
        self._mic_btn.pack(fill='x', padx=10)
        self._mic_btn.bind('<ButtonPress-1>',   self._on_mic_press)
        self._mic_btn.bind('<ButtonRelease-1>', self._on_mic_release)

        # Status bar
        self._status_bar = tk.Label(
            input_row, text='', fg=t['status_text'], bg=t['bg2'],
            font=self.f_small, anchor='w',
        )
        self._status_bar.pack(fill='x', padx=12, pady=(4, 2))

    def _on_chat_configure(self, event):
        self._canvas.configure(scrollregion=self._canvas.bbox('all'))

    def _on_canvas_configure(self, event):
        self._canvas.itemconfig(self._canvas_window, width=event.width)

    def _scroll_to_bottom(self):
        self.root.after(50, lambda: self._canvas.yview_moveto(1.0))

    # ─────────────────────────────────────────────────────────────────────────
    # Placeholder
    # ─────────────────────────────────────────────────────────────────────────

    def _ph_in(self, event):
        if self._text_entry.get() == 'Escribe un mensaje…':
            self._text_entry.delete(0, tk.END)
            self._text_entry.config(fg=self.t['text'])

    def _ph_out(self, event):
        if not self._text_entry.get():
            self._text_entry.insert(0, 'Escribe un mensaje…')
            self._text_entry.config(fg=self.t['dim'])

    # ─────────────────────────────────────────────────────────────────────────
    # Tema
    # ─────────────────────────────────────────────────────────────────────────

    def _toggle_theme(self):
        new = 'light' if self.theme_name == 'dark' else 'dark'
        self.theme_name = new
        self.t = THEMES[new]
        try:
            open(THEME_FILE, 'w').write(new)
        except Exception:
            pass
        self._apply_theme()

    def _apply_theme(self):
        t = self.t
        self.root.configure(bg=t['bg'])
        self._hdr.configure(bg=t['bg2'])
        self._toggle_btn.configure(bg=t['bg2'], fg=t['text'], text=t['toggle_icon'])
        for lbl in self._hdr.winfo_children():
            if isinstance(lbl, tk.Label):
                lbl.configure(bg=t['bg2'])
        self._canvas.configure(bg=t['bg'])
        self._chat_frame.configure(bg=t['bg'])
        self._bottom.configure(bg=t['bg2'])
        self._preview_frame.configure(bg=t['bg3'])
        self._countdown_lbl.configure(bg=t['bg3'], fg=t['yellow'])
        self._preview_entry.configure(bg=t['bg2'], fg=t['text'], insertbackground=t['text'])
        self._prev_send_btn.configure(bg=t['accent'], fg=t['bg'])
        self._text_entry.configure(bg=t['bg3'], insertbackground=t['text'])
        self._send_btn.configure(bg=t['accent'], fg=t['bg'])
        self._mic_btn.configure(bg=t['btn'], fg=t['text'])
        self._status_bar.configure(bg=t['bg2'], fg=t['status_text'])

        # Actualizar burbujas existentes
        for row, bubble, label, reuse_btn, role in self.msg_widgets:
            row.configure(bg=t['bg'])
            bk = t[f'{role}_bubble']
            tx = t[f'{role}_text']
            bubble.configure(bg=bk)
            label.configure(bg=bk, fg=tx)
            reuse_btn.configure(bg=bk, fg=t['dim'],
                                activebackground=bk, activeforeground=t['accent'])

        # Actualizar header labels
        for w in self._hdr.winfo_children():
            if isinstance(w, tk.Label):
                w.configure(bg=t['bg2'], fg=t['text'] if 'BAKO' in (w.cget('text') or '') else t['dim'])

    # ─────────────────────────────────────────────────────────────────────────
    # Chat messages
    # ─────────────────────────────────────────────────────────────────────────

    def _add_message(self, role: str, text: str):
        self.messages.append((role, text))
        self._render_message(role, text)

    def _render_message(self, role: str, text: str):
        t = self.t
        bk = t[f'{role}_bubble']
        tx = t[f'{role}_text']

        row = tk.Frame(self._chat_frame, bg=t['bg'])
        row.pack(fill='x', padx=8, pady=3)

        bubble = tk.Frame(row, bg=bk)
        label  = tk.Label(
            bubble, text=text, bg=bk, fg=tx, font=self.f_normal,
            wraplength=330, justify='left', padx=10, pady=7,
        )
        label.pack(side='left')

        reuse_btn = tk.Button(
            bubble, text='↩', bg=bk, fg=t['dim'],
            relief='flat', font=self.f_small, cursor='hand2',
            padx=4, pady=2,
            activebackground=bk, activeforeground=t['accent'],
            command=lambda txt=text: self._reuse_message(txt),
        )
        reuse_btn.pack(side='right', padx=(0, 4), pady=4)

        if role == 'user':
            bubble.pack(side='right', padx=(60, 0))
        else:
            bubble.pack(side='left',  padx=(0, 60))

        self.msg_widgets.append((row, bubble, label, reuse_btn, role))
        self._scroll_to_bottom()

    def _reuse_message(self, text: str):
        self._text_entry.delete(0, tk.END)
        self._text_entry.config(fg=self.t['text'])
        self._text_entry.insert(0, text)
        self._text_entry.focus_set()

    def _add_status_msg(self, text: str, color: str = None):
        t = self.t
        fg = color or t['status_text']
        row = tk.Frame(self._chat_frame, bg=t['bg'])
        row.pack(fill='x', pady=2)
        tk.Label(row, text=text, bg=t['bg'], fg=fg,
                 font=self.f_small).pack(anchor='center')
        self.msg_widgets.append((row, row, row, row, 'status'))
        self._scroll_to_bottom()

    # ─────────────────────────────────────────────────────────────────────────
    # Status bar helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _set_status(self, msg: str, color: str = None):
        fg = color or self.t['status_text']
        self.root.after(0, lambda: self._status_bar.config(text=msg, fg=fg))

    def _set_ui_enabled(self, enabled: bool):
        if enabled and self._cooling_down():
            return
        state = 'normal' if enabled else 'disabled'
        def _do():
            self._mic_btn.config(state=state)
            self._send_btn.config(state=state)
            self._prev_send_btn.config(state=state)
            self._text_entry.config(state=state)
            op = '' if enabled else '0.4'
            if op:
                self._mic_btn.config(cursor='arrow')
                self._send_btn.config(cursor='arrow')
            else:
                self._mic_btn.config(cursor='hand2')
                self._send_btn.config(cursor='hand2')
        self.root.after(0, _do)

    # ─────────────────────────────────────────────────────────────────────────
    # Rate limit
    # ─────────────────────────────────────────────────────────────────────────

    def _cooling_down(self) -> bool:
        return time.time() < self.cooldown_until

    def _set_cooldown(self, secs: int):
        self.cooldown_until = time.time() + secs
        def _do():
            self._mic_btn.config(state='disabled', cursor='arrow')
            self._send_btn.config(state='disabled', cursor='arrow')
            self._prev_send_btn.config(state='disabled')
            self._text_entry.config(state='disabled')
        self.root.after(0, _do)
        self._tick_cooldown()

    def _tick_cooldown(self):
        rem = int(self.cooldown_until - time.time())
        if rem > 0:
            self._set_status(f'🚫 Rate limit — {rem}s', self.t['red'])
            self.root.after(1000, self._tick_cooldown)
        else:
            self.cooldown_until = 0
            self._set_ui_enabled(True)
            self._set_status('✅ Listo')

    def _parse_cooldown(self, text: str) -> int:
        m = re.search(r'(\d+)\s*(?:s\b|sec|second|segundo)', text, re.I)
        return min(int(m.group(1)), 120) if m else 30

    def _wait_gap(self):
        elapsed = time.time() - self.last_request_time
        if elapsed < MIN_REQUEST_GAP:
            time.sleep(MIN_REQUEST_GAP - elapsed)

    # ─────────────────────────────────────────────────────────────────────────
    # Grabación
    # ─────────────────────────────────────────────────────────────────────────

    def _on_mic_press(self, event=None):
        if self._cooling_down() or self.is_recording:
            return
        with self.lock:
            self.is_recording = True
            self.audio_frames = []
        self.root.after(0, lambda: self._mic_btn.config(
            bg='#0d2b0d', text='🔴  Grabando… (suelta para revisar)', fg=self.t['green']))
        self._set_status('🎤 Grabando…', self.t['green'])
        threading.Thread(target=self._record_loop, daemon=True).start()

    def _on_mic_release(self, event=None):
        with self.lock:
            self.is_recording = False
        self.root.after(0, lambda: self._mic_btn.config(
            bg=self.t['btn'],
            text=f'🎤  Mantén para hablar  ({HOTKEY.upper()})',
            fg=self.t['text'],
        ))

    def _record_loop(self):
        def cb(indata, frames, t, status):
            with self.lock:
                if not self.is_recording:
                    raise sd.CallbackAbort
                self.audio_frames.append(indata.copy())
        try:
            with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                                dtype='int16', blocksize=1024, callback=cb):
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

        frames = self.audio_frames[:]
        if not frames:
            self._set_status('✅ Listo')
            return

        self._set_status('🔄 Transcribiendo…', self.t['yellow'])
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

            if resp.status_code == 429:
                secs = self._parse_cooldown(resp.text)
                self._set_cooldown(secs)
                self.root.after(0, lambda: self._add_status_msg(
                    f'🚫 Rate limit — {secs}s', self.t['red']))
                return

            if resp.status_code != 200:
                self.root.after(0, lambda: self._add_status_msg(
                    'No se detectó habla', self.t['yellow']))
                self._set_status('✅ Listo')
                return

            text = resp.json().get('transcription', '').strip()
            if not text:
                self.root.after(0, lambda: self._add_status_msg(
                    'No se detectó habla', self.t['yellow']))
                self._set_status('✅ Listo')
                return

            self.root.after(0, lambda: self._show_preview(text))

        except requests.exceptions.ConnectionError:
            self.root.after(0, lambda: self._add_status_msg(
                '⚠️ Sin conexión con BAKO', self.t['red']))
            self._set_status('✅ Listo')
        except Exception as e:
            self.root.after(0, lambda: self._add_status_msg(str(e), self.t['red']))
            self._set_status('✅ Listo')

    def _show_preview(self, text: str):
        self.pending_text  = text
        self.user_editing  = False
        self._preview_var.set(text)
        self._preview_frame.pack(fill='x', before=self._bottom.winfo_children()[-1]
                                 if self._bottom.winfo_children() else None)
        self._preview_frame.pack(fill='x')
        self._set_status(f'📝 Revisa — enviando en {REVIEW_TIMEOUT}s…', self.t['yellow'])
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
        self._countdown_lbl.config(text=f'Enviando en {self.countdown_val}s…')
        self.countdown_val -= 1
        self.countdown_job = self.root.after(1000, self._tick_countdown_preview)

    def _on_preview_edit(self, event=None):
        if not self.user_editing:
            self.user_editing = True
            if self.countdown_job:
                self.root.after_cancel(self.countdown_job)
                self.countdown_job = None
            self._countdown_lbl.config(text='✏️ Editado')
            self._set_status('✏️ Editado — pulsa Enviar o Enter', self.t['accent'])

    def _send_preview(self):
        text = self._preview_var.get().strip()
        self._cancel_preview()
        if text and not self._cooling_down():
            threading.Thread(target=self._send_and_display, args=(text,), daemon=True).start()

    def _cancel_preview(self):
        if self.countdown_job:
            self.root.after_cancel(self.countdown_job)
            self.countdown_job = None
        self.pending_text = None
        def _do():
            self._preview_frame.pack_forget()
            if not self._cooling_down():
                self._set_status('✅ Listo')
        self.root.after(0, _do)

    # ─────────────────────────────────────────────────────────────────────────
    # Input de texto
    # ─────────────────────────────────────────────────────────────────────────

    def _send_text_input(self):
        if self._cooling_down():
            return
        text = self._text_entry.get().strip()
        if not text or text == 'Escribe un mensaje…':
            return
        self._text_entry.delete(0, tk.END)
        self._text_entry.config(fg=self.t['dim'])
        self._text_entry.insert(0, 'Escribe un mensaje…')
        threading.Thread(target=self._send_and_display, args=(text,), daemon=True).start()

    # ─────────────────────────────────────────────────────────────────────────
    # Envío a BAKO
    # ─────────────────────────────────────────────────────────────────────────

    def _send_and_display(self, text: str):
        if self._cooling_down():
            return

        self._wait_gap()
        self.root.after(0, lambda: self._add_message('user', text))
        self._set_ui_enabled(False)
        self._set_status('📡 Enviando a BAKO…', self.t['accent'])

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

            if resp.status_code == 429:
                data = resp.json() if resp.content else {}
                secs = self._parse_cooldown(str(data))
                self._set_cooldown(secs)
                self.root.after(0, lambda: self._add_status_msg(
                    f'🚫 Rate limit — {secs}s', self.t['red']))
                return

            if resp.status_code == 413:
                self.root.after(0, lambda: self._add_status_msg(
                    '⚠️ Contexto muy grande. Intenta de nuevo.', self.t['yellow']))
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')
                return

            if resp.status_code >= 400:
                err = resp.json().get('error', f'Error {resp.status_code}')
                self.root.after(0, lambda: self._add_status_msg(f'⚠️ {err}', self.t['yellow']))
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')
                return

            data = resp.json()
            response_text = self._strip_md(data.get('response', ''))
            if response_text:
                self.root.after(0, lambda: self._add_message('bako', response_text))

            if 'audio' in data:
                self._set_status('🔊 Reproduciendo…', self.t['green'])
                threading.Thread(
                    target=self._play_audio, args=(data['audio'],), daemon=True
                ).start()
            else:
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')

        except requests.exceptions.ConnectionError:
            self.root.after(0, lambda: self._add_status_msg(
                '⚠️ Sin conexión con BAKO', self.t['red']))
            if not self._cooling_down():
                self._set_ui_enabled(True)
                self._set_status('⚠️ Sin conexión', self.t['red'])
        except Exception as e:
            self.root.after(0, lambda: self._add_status_msg(str(e), self.t['red']))
            if not self._cooling_down():
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')

    @staticmethod
    def _strip_md(text: str) -> str:
        return re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1',
               re.sub(r'_{1,2}([^_]+)_{1,2}', r'\1',
               re.sub(r'`{1,3}[^`]*`{1,3}', '',
               re.sub(r'#{1,6}\s+', '',
               re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1',
               re.sub(r'https?://\S+', '',
               re.sub(r'\*', '', text)))))))

    # ─────────────────────────────────────────────────────────────────────────
    # Audio
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
                    os.startfile(tmp.name); time.sleep(3)
                elif sys.platform == 'darwin':
                    subprocess.run(['afplay', tmp.name])
                else:
                    subprocess.run(['aplay', tmp.name])
        finally:
            try:
                os.unlink(tmp.name)
            except Exception:
                pass
        if not self._cooling_down():
            self._set_ui_enabled(True)
            self._set_status('✅ Listo')

    # ─────────────────────────────────────────────────────────────────────────
    # Hotkey global
    # ─────────────────────────────────────────────────────────────────────────

    def _setup_hotkey(self):
        if not HAS_KEYBOARD:
            return
        try:
            parts   = HOTKEY.lower().split('+')
            trigger = parts[-1]
            mods    = parts[:-1]
            keyboard.on_press_key(trigger, lambda _:
                self.root.after(0, self._on_mic_press) if self._mods_ok(mods) else None)
            keyboard.on_release_key(trigger, lambda _:
                self.root.after(0, self._on_mic_release))
        except Exception as e:
            print(f'⚠️  Hotkey no disponible: {e}')

    def _mods_ok(self, mods) -> bool:
        if 'ctrl'  in mods and not keyboard.is_pressed('ctrl'):  return False
        if 'alt'   in mods and not keyboard.is_pressed('alt'):   return False
        if 'shift' in mods and not keyboard.is_pressed('shift'): return False
        return True


# ── Punto de entrada ───────────────────────────────────────────────────────────

def main():
    root = tk.Tk()
    app  = BakoDesktopApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()
