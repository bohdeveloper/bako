#!/usr/bin/env python3
"""
BAKO Desktop v4 — sincronizado con PWA v4.

Novedades respecto a v3:
  - Auth JWT con sesión persistente (30 días)
  - Interrupción de BAKO mientras piensa o habla (clic en el botón mic)
  - Menú de presets ⚡ con 63 comandos en 11 categorías
  - Panel de administración de usuarios (superadmin)
  - Compatibilidad retroactiva con DESKTOP_TOKEN (legacy)

Instalación:
  pip install -r requirements.txt
"""

import os, sys, time, tempfile, threading, wave, base64, re, json
import tkinter as tk
from tkinter import font as tkfont, messagebox
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
DESKTOP_TOKEN   = os.getenv('DESKTOP_TOKEN', '')   # legacy — si está definido, omite login JWT
HOTKEY          = os.getenv('BAKO_HOTKEY',   'ctrl+alt+b')
SAMPLE_RATE     = 16000
CHANNELS        = 1
MAX_DURATION    = 15
REVIEW_TIMEOUT  = 5
MIN_REQUEST_GAP = 3
THEME_FILE      = os.path.join(os.path.expanduser('~'), '.bako_theme')
TOKEN_FILE      = os.path.join(os.path.expanduser('~'), '.bako_token')
USER_FILE       = os.path.join(os.path.expanduser('~'), '.bako_user')

# ── Presets (sincronizados con PWA) ───────────────────────────────────────────
PRESETS = [
    ('📅 Agenda', [
        '¿Qué tengo hoy?',
        '¿Cuál es mi próximo evento?',
        '¿Tengo algo esta semana?',
        '¿Qué reuniones tengo pendientes?',
        '¿Qué tengo mañana?',
        '¿Tengo algo este fin de semana?',
    ]),
    ('🌤 Estado del día', [
        '¿Cómo está el tiempo ahora?',
        '¿Lloverá hoy?',
        '¿Qué debería estar haciendo ahora?',
        'Dame un resumen del día',
        '¿Cuánto falta para que acabe la jornada?',
        '¿Estoy cumpliendo la rutina hoy?',
    ]),
    ('🚀 Proyectos', [
        '¿En qué debería enfocarme ahora?',
        'Resume mis proyectos activos',
        '¿Cuál es el estado de BAKO?',
        '¿Cuál es el estado de Diamadmin?',
        '¿Cuál es el estado de bohdeveloper?',
        '¿Qué proyecto lleva más tiempo parado?',
        '¿Cuál es mi siguiente acción en BAKO?',
        '¿Cuáles son mis proyectos diferidos?',
    ]),
    ('💼 Trabajo', [
        '¿Cómo va la búsqueda de empleo?',
        '¿Qué debería preparar para una entrevista?',
        'Dame ideas para mejorar mi perfil de LinkedIn',
        '¿Cuánto tiempo llevo en Inetum sin proyecto?',
        'Ayúdame a redactar un mensaje profesional para…',
    ]),
    ('👤 Personal y familia', [
        '¿Qué recuerdas de mí?',
        '¿Cuándo cumple años alguien próximamente?',
        '¿Cuándo es el aniversario con Yaimy?',
        '¿Cómo está la búsqueda de casa en Galicia?',
        '¿Cuándo nos mudamos a Galicia?',
        'Cuéntame algo sobre Yaimy',
        'Dame motivación para hoy',
    ]),
    ('💪 Entrenamiento', [
        '¿Qué entreno hoy?',
        '¿Tengo BIZIKI hoy?',
        '¿Cuál es mi rutina de entrenamiento esta semana?',
        'Recuérdame el Kronoshin de mañana',
        '¿He hecho el Kronoshin hoy?',
        '¿Qué músculos toca hoy en el gym?',
    ]),
    ('🧘 Rutina y hábitos', [
        '¿Cuál es mi rutina de hoy?',
        '¿He cumplido mis objetivos del día?',
        'Recuérdame mi rutina matutina',
        '¿Tengo psicólogo esta semana?',
        '¿Cómo van mis hábitos estoicos?',
        'Dame una cita estoica para arrancar el día',
        '¿Qué hago esta noche?',
    ]),
    ('💰 Finanzas e ingresos', [
        '¿Cuál es mi situación financiera?',
        '¿Cómo van los proyectos de ingresos pasivos?',
        'Dame ideas para monetizar mis habilidades',
        '¿Cuál es el plan de Kefir artesanal?',
        '¿Qué plataformas tengo para vender productos digitales?',
    ]),
    ('🤖 BAKO y tecnología', [
        '¿Cuáles son los próximos pasos de BAKO?',
        '¿Qué gaps le faltan a BAKO para ser un mayordomo real?',
        '¿Qué modelos de IA debería explorar?',
        '¿Cuál es el stack técnico de mis proyectos?',
        'Explícame el estado de la infraestructura de BAKO',
    ]),
    ('✏️ Anotar y recordar', [
        'Anota que…',
        'Recuérdame mañana que…',
        'Recuérdame el lunes que…',
        'Guarda en mi memoria que…',
        'Crea un evento en el calendario para…',
        'Olvida lo que sabes sobre…',
    ]),
    ('🎮 Ocio y tiempo libre', [
        '¿Qué puedo hacer este fin de semana?',
        'Recomiéndame una película o serie',
        '¿Qué rutas de monte hay cerca de Errentería?',
        'Dame ideas para un plan con Yaimy',
        '¿Cómo va el proyecto Matrix Game?',
        '¿Qué avance llevan los drones FPV?',
    ]),
]

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
        self.root.title("BAKO Desktop v4")
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
        self.messages          = []
        self.msg_widgets       = []

        # ── Auth + interrupt ──────────────────────────────────────────────────
        self.jwt_token    = ''
        self.bako_role    = 'user'
        self._is_active   = False   # True mientras BAKO procesa o reproduce
        self._cancel_flag = threading.Event()

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

        # Auth: si hay DESKTOP_TOKEN, acceso directo; si no, usar JWT
        if DESKTOP_TOKEN:
            self._add_message('bako', '¿En qué puedo ayudarle, señor?')
            self._set_status('✅ Listo')
        elif self._load_auth():
            self._update_admin_btn()
            self._add_message('bako', '¿En qué puedo ayudarle, señor?')
            self._set_status('✅ Listo')
        else:
            self.root.after(150, self._show_login_dialog)

    # ─────────────────────────────────────────────────────────────────────────
    # Auth
    # ─────────────────────────────────────────────────────────────────────────

    def _load_auth(self) -> bool:
        try:
            if os.path.exists(TOKEN_FILE):
                self.jwt_token = open(TOKEN_FILE).read().strip()
            if os.path.exists(USER_FILE):
                u = json.loads(open(USER_FILE).read())
                self.bako_role = u.get('role', 'user')
            return bool(self.jwt_token)
        except Exception:
            return False

    def _save_auth(self, token: str, user: dict):
        self.jwt_token = token
        self.bako_role = user.get('role', 'user')
        try:
            open(TOKEN_FILE, 'w').write(token)
            open(USER_FILE, 'w').write(json.dumps(user))
        except Exception:
            pass

    def _clear_auth(self):
        self.jwt_token = ''
        self.bako_role = 'user'
        for f in (TOKEN_FILE, USER_FILE):
            try: os.remove(f)
            except Exception: pass

    def _get_headers(self, json_content=True) -> dict:
        h = {}
        if json_content:
            h['Content-Type'] = 'application/json'
        if DESKTOP_TOKEN:
            h['x-desktop-token'] = DESKTOP_TOKEN
        elif self.jwt_token:
            h['Authorization'] = f'Bearer {self.jwt_token}'
        return h

    def _update_admin_btn(self):
        """Muestra/oculta el botón admin según el rol."""
        def _do():
            if self.bako_role == 'superadmin':
                self._admin_btn.pack(side='left', padx=(6, 0))
            else:
                self._admin_btn.pack_forget()
        self.root.after(0, _do)

    def _show_login_dialog(self):
        dlg = tk.Toplevel(self.root)
        dlg.title('BAKO — Acceder')
        dlg.transient(self.root)
        dlg.grab_set()
        dlg.resizable(False, False)
        dlg.configure(bg=self.t['bg2'])
        dlg.update_idletasks()
        w, h = 300, 290
        x = self.root.winfo_x() + (self.root.winfo_width()  - w) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - h) // 2
        dlg.geometry(f'{w}x{h}+{x}+{y}')

        tk.Label(dlg, text='BAKO', font=self.f_title,
                 bg=self.t['bg2'], fg=self.t['text']).pack(pady=(20, 4))
        tk.Label(dlg, text='MAYORDOMO PERSONAL', font=self.f_small,
                 bg=self.t['bg2'], fg=self.t['dim']).pack()

        frm = tk.Frame(dlg, bg=self.t['bg2'])
        frm.pack(padx=20, pady=16, fill='x')

        user_var = tk.StringVar()
        pass_var = tk.StringVar()

        user_e = tk.Entry(frm, textvariable=user_var, bg=self.t['bg3'], fg=self.t['dim'],
                          relief='flat', font=self.f_normal, insertbackground=self.t['text'])
        user_e.pack(fill='x', ipady=6, pady=(0, 8))
        user_e.insert(0, 'Usuario')
        user_e.bind('<FocusIn>', lambda e: (user_e.delete(0, 'end'),
                                            user_e.config(fg=self.t['text'])) if user_e.get() == 'Usuario' else None)

        pass_e = tk.Entry(frm, textvariable=pass_var, show='●', bg=self.t['bg3'], fg=self.t['text'],
                          relief='flat', font=self.f_normal, insertbackground=self.t['text'])
        pass_e.pack(fill='x', ipady=6, pady=(0, 8))

        err_lbl = tk.Label(frm, text='', fg=self.t['red'], bg=self.t['bg2'], font=self.f_small)
        err_lbl.pack()

        def do_login():
            u = user_var.get().strip()
            p = pass_var.get()
            if not u or u == 'Usuario' or not p:
                err_lbl.config(text='Rellena usuario y contraseña')
                return
            login_btn.config(state='disabled', text='Accediendo…')
            def _req():
                try:
                    r = requests.post(f'{BAKO_URL}/api/auth/login',
                                      json={'username': u, 'password': p}, timeout=15)
                    if r.ok:
                        data = r.json()
                        self._save_auth(data['token'], data['user'])
                        self.root.after(0, lambda: [
                            dlg.destroy(),
                            self._update_admin_btn(),
                            self._add_message('bako', '¿En qué puedo ayudarle, señor?'),
                            self._set_status('✅ Listo'),
                        ])
                    else:
                        msg = r.json().get('error', 'Error al acceder')
                        self.root.after(0, lambda: [
                            err_lbl.config(text=msg),
                            login_btn.config(state='normal', text='Acceder'),
                        ])
                except Exception:
                    self.root.after(0, lambda: [
                        err_lbl.config(text='Sin conexión con BAKO'),
                        login_btn.config(state='normal', text='Acceder'),
                    ])
            threading.Thread(target=_req, daemon=True).start()

        login_btn = tk.Button(frm, text='Acceder', command=do_login,
                              bg=self.t['accent'], fg=self.t['bg'],
                              relief='flat', font=self.f_bold, pady=8, cursor='hand2')
        login_btn.pack(fill='x', pady=(4, 0))

        user_e.bind('<Return>', lambda e: pass_e.focus())
        pass_e.bind('<Return>', lambda e: do_login())
        user_e.focus()
        dlg.protocol('WM_DELETE_WINDOW', lambda: None)  # no cerrar sin login

    def _logout(self):
        self._clear_auth()
        self._update_admin_btn()
        self.root.after(100, self._show_login_dialog)

    # ─────────────────────────────────────────────────────────────────────────
    # Interrupt BAKO
    # ─────────────────────────────────────────────────────────────────────────

    def _stop_bako(self):
        """Cancela la petición en curso o detiene el audio."""
        self._cancel_flag.set()
        if PLAYER == 'pygame':
            try: pygame.mixer.music.stop()
            except Exception: pass
        self._is_active = False
        def _do():
            self._mic_btn.config(
                bg=self.t['btn'],
                text=f'🎤  Mantén para hablar  ({HOTKEY.upper()})',
                fg=self.t['text'], state='normal', cursor='hand2',
            )
            self._set_status('⏹ Interrumpido')
        self.root.after(0, _do)
        self._set_ui_enabled(True)

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

        # Botón admin (oculto hasta login superadmin)
        self._admin_btn = tk.Button(
            self._hdr, text='⚙', bg=t['bg2'], fg=t['dim'],
            relief='flat', font=tkfont.Font(size=12), cursor='hand2',
            command=self._show_admin_panel,
        )

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

        # Chat area
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

        tk.Frame(self._bottom, bg=t['border'], height=1).pack(fill='x')

        # Input row: [⚡] [texto] [🎤/⏹] [➤]
        input_row = tk.Frame(self._bottom, bg=t['bg2'], pady=8)
        input_row.pack(fill='x')

        txt_frame = tk.Frame(input_row, bg=t['bg2'])
        txt_frame.pack(fill='x', padx=10, pady=(0, 6))
        txt_frame.columnconfigure(1, weight=1)

        # Botón presets ⚡
        self._presets_btn = tk.Button(
            txt_frame, text='⚡', bg=t['btn'], fg=t['text'],
            relief='flat', font=tkfont.Font(size=12), cursor='hand2',
            width=2, pady=4, command=self._show_presets,
        )
        self._presets_btn.grid(row=0, column=0, padx=(0, 6))

        self._text_entry = tk.Entry(
            txt_frame, bg=t['bg3'], fg=t['dim'], font=self.f_normal,
            relief='flat', insertbackground=t['text'],
        )
        self._text_entry.insert(0, 'Escribe un mensaje…')
        self._text_entry.grid(row=0, column=1, sticky='ew', ipady=6)
        self._text_entry.bind('<FocusIn>',  self._ph_in)
        self._text_entry.bind('<FocusOut>', self._ph_out)
        self._text_entry.bind('<Return>',   lambda _: self._send_text_input())

        # Mic inline (también sirve de botón stop)
        self._mic_btn = tk.Button(
            txt_frame,
            text=f'🎤',
            bg=t['btn'], fg=t['text'], relief='flat', font=self.f_normal,
            width=3, pady=4, cursor='hand2',
        )
        self._mic_btn.grid(row=0, column=2, padx=(6, 6))
        self._mic_btn.bind('<ButtonPress-1>',   self._on_mic_press)
        self._mic_btn.bind('<ButtonRelease-1>', self._on_mic_release)

        self._send_btn = tk.Button(
            txt_frame, text='➤', command=self._send_text_input,
            bg=t['accent'], fg=t['bg'], relief='flat', font=self.f_bold,
            width=3, pady=4, cursor='hand2',
        )
        self._send_btn.grid(row=0, column=3, padx=(0, 0))

        self._status_bar = tk.Label(
            input_row, text='', fg=t['status_text'], bg=t['bg2'],
            font=self.f_small, anchor='w',
        )
        self._status_bar.pack(fill='x', padx=12, pady=(4, 2))

    # ─────────────────────────────────────────────────────────────────────────
    # Presets
    # ─────────────────────────────────────────────────────────────────────────

    def _show_presets(self):
        popup = tk.Toplevel(self.root)
        popup.title('⚡ Comandos rápidos')
        popup.transient(self.root)
        popup.resizable(True, True)
        w, h = 340, 520
        x = self.root.winfo_x() + self.root.winfo_width() + 4
        y = self.root.winfo_y()
        popup.geometry(f'{w}x{h}+{x}+{y}')
        popup.configure(bg=self.t['bg2'])

        tk.Label(popup, text='⚡ Comandos rápidos', font=self.f_bold,
                 bg=self.t['bg2'], fg=self.t['text']).pack(padx=12, pady=(12, 6))

        canvas = tk.Canvas(popup, bg=self.t['bg2'], highlightthickness=0)
        sb     = tk.Scrollbar(popup, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=sb.set)
        sb.pack(side='right', fill='y')
        canvas.pack(fill='both', expand=True, padx=4)

        frm = tk.Frame(canvas, bg=self.t['bg2'])
        canvas.create_window((0, 0), window=frm, anchor='nw')

        def on_preset(text):
            self._reuse_message(text)
            popup.destroy()
            if not text.endswith('…'):
                self.root.after(50, self._send_text_input)

        for cat, items in PRESETS:
            tk.Label(frm, text=cat, font=self.f_small,
                     bg=self.t['bg2'], fg=self.t['dim']).pack(anchor='w', padx=10, pady=(10, 3))
            for item in items:
                btn = tk.Button(
                    frm, text=item, anchor='w', relief='flat',
                    bg=self.t['bg3'], fg=self.t['text'], font=self.f_normal,
                    padx=10, pady=4, cursor='hand2', wraplength=300,
                    command=lambda t=item: on_preset(t),
                )
                btn.pack(fill='x', padx=8, pady=1)

        frm.update_idletasks()
        canvas.configure(scrollregion=canvas.bbox('all'))
        canvas.bind_all('<MouseWheel>', lambda e: canvas.yview_scroll(
            int(-1 * (e.delta / 120)), 'units'))

    # ─────────────────────────────────────────────────────────────────────────
    # Admin panel
    # ─────────────────────────────────────────────────────────────────────────

    def _show_admin_panel(self):
        dlg = tk.Toplevel(self.root)
        dlg.title('⚙ Gestión de usuarios')
        dlg.transient(self.root)
        dlg.resizable(True, True)
        w, h = 360, 500
        x = self.root.winfo_x() + (self.root.winfo_width()  - w) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - h) // 2
        dlg.geometry(f'{w}x{h}+{x}+{y}')
        dlg.configure(bg=self.t['bg2'])

        tk.Label(dlg, text='⚙ Gestión de usuarios', font=self.f_bold,
                 bg=self.t['bg2'], fg=self.t['text']).pack(padx=14, pady=(14, 4))

        canvas = tk.Canvas(dlg, bg=self.t['bg2'], highlightthickness=0)
        sb     = tk.Scrollbar(dlg, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=sb.set)
        sb.pack(side='right', fill='y')
        canvas.pack(fill='both', expand=True, padx=4)

        content = tk.Frame(canvas, bg=self.t['bg2'])
        canvas.create_window((0, 0), window=content, anchor='nw')
        content.bind('<Configure>', lambda e: canvas.configure(
            scrollregion=canvas.bbox('all')))

        # Lista de usuarios
        user_section = tk.Frame(content, bg=self.t['bg2'])
        user_section.pack(fill='x', padx=10, pady=(4, 0))
        tk.Label(user_section, text='Usuarios', font=self.f_small,
                 bg=self.t['bg2'], fg=self.t['dim']).pack(anchor='w', pady=(0, 4))

        users_frame = tk.Frame(user_section, bg=self.t['bg2'])
        users_frame.pack(fill='x')
        status_lbl = tk.Label(user_section, text='', fg=self.t['dim'],
                              bg=self.t['bg2'], font=self.f_small)
        status_lbl.pack(anchor='w')

        def load_users():
            for w in users_frame.winfo_children():
                w.destroy()
            tk.Label(users_frame, text='Cargando…', fg=self.t['dim'],
                     bg=self.t['bg2'], font=self.f_small).pack()

            def _req():
                try:
                    r = requests.get(f'{BAKO_URL}/api/auth/users',
                                     headers=self._get_headers(), timeout=10)
                    users = r.json().get('users', []) if r.ok else []
                    self.root.after(0, lambda: render_users(users))
                except Exception:
                    self.root.after(0, lambda: [
                        users_frame.winfo_children()[0].config(text='Error al cargar')
                        if users_frame.winfo_children() else None])
            threading.Thread(target=_req, daemon=True).start()

        def render_users(users):
            for w in users_frame.winfo_children():
                w.destroy()
            if not users:
                tk.Label(users_frame, text='Sin usuarios', fg=self.t['dim'],
                         bg=self.t['bg2'], font=self.f_small).pack()
                return
            for u in users:
                row = tk.Frame(users_frame, bg=self.t['bg3'])
                row.pack(fill='x', pady=2)
                info = tk.Frame(row, bg=self.t['bg3'])
                info.pack(side='left', fill='x', expand=True, padx=8, pady=6)
                name_color = self.t['dim'] if not u.get('active') else self.t['text']
                tk.Label(info, text=u['username'], fg=name_color,
                         bg=self.t['bg3'], font=self.f_bold).pack(anchor='w')
                tk.Label(info, text=f"{u['role']} · {'activo' if u.get('active') else 'inactivo'}",
                         fg=self.t['dim'], bg=self.t['bg3'], font=self.f_small).pack(anchor='w')

                if u['role'] != 'superadmin':
                    btn_frame = tk.Frame(row, bg=self.t['bg3'])
                    btn_frame.pack(side='right', padx=6)

                    def toggle_user(uid=u['_id']):
                        def _req():
                            requests.patch(f'{BAKO_URL}/api/auth/users/{uid}/toggle',
                                           headers=self._get_headers(), timeout=10)
                            self.root.after(0, load_users)
                        threading.Thread(target=_req, daemon=True).start()

                    def delete_user(uid=u['_id'], uname=u['username']):
                        if messagebox.askyesno('Confirmar', f'¿Eliminar usuario "{uname}"?'):
                            def _req():
                                requests.delete(f'{BAKO_URL}/api/auth/users/{uid}',
                                                headers=self._get_headers(), timeout=10)
                                self.root.after(0, load_users)
                            threading.Thread(target=_req, daemon=True).start()

                    tk.Button(btn_frame, text='🔒' if u.get('active') else '🔓',
                              bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                              cursor='hand2', command=toggle_user).pack(side='left')
                    tk.Button(btn_frame, text='🗑', bg=self.t['bg3'], fg=self.t['dim'],
                              relief='flat', cursor='hand2', command=delete_user).pack(side='left')

        # Crear usuario
        tk.Frame(content, bg=self.t['border'], height=1).pack(fill='x', padx=10, pady=10)
        create_frm = tk.Frame(content, bg=self.t['bg3'])
        create_frm.pack(fill='x', padx=10, pady=(0, 6))
        tk.Label(create_frm, text='Crear usuario', font=self.f_small,
                 bg=self.t['bg3'], fg=self.t['dim']).pack(anchor='w', padx=8, pady=(6, 4))

        nu_var, np_var, nr_var = tk.StringVar(), tk.StringVar(), tk.StringVar(value='user')
        for placeholder, var, show in [('Nombre de usuario', nu_var, ''), ('Contraseña', np_var, '●')]:
            e = tk.Entry(create_frm, textvariable=var, bg=self.t['bg2'], fg=self.t['text'],
                         relief='flat', font=self.f_normal, insertbackground=self.t['text'],
                         show=show if show else '')
            e.pack(fill='x', padx=8, ipady=5, pady=2)

        role_frame = tk.Frame(create_frm, bg=self.t['bg3'])
        role_frame.pack(fill='x', padx=8, pady=2)
        for label, val in [('Usuario', 'user'), ('Superadmin', 'superadmin')]:
            tk.Radiobutton(role_frame, text=label, variable=nr_var, value=val,
                           bg=self.t['bg3'], fg=self.t['text'], selectcolor=self.t['bg2'],
                           activebackground=self.t['bg3']).pack(side='left', padx=4)

        fb_lbl = tk.Label(create_frm, text='', fg=self.t['green'],
                          bg=self.t['bg3'], font=self.f_small)
        fb_lbl.pack(padx=8)

        def create_user():
            u, p, r = nu_var.get().strip(), np_var.get(), nr_var.get()
            if not u or not p:
                fb_lbl.config(text='Rellena usuario y contraseña', fg=self.t['red']); return
            def _req():
                try:
                    res = requests.post(f'{BAKO_URL}/api/auth/users',
                                        json={'username': u, 'password': p, 'role': r},
                                        headers=self._get_headers(), timeout=10)
                    if res.ok:
                        self.root.after(0, lambda: [
                            fb_lbl.config(text=f'✓ {u} creado', fg=self.t['green']),
                            nu_var.set(''), np_var.set(''),
                            load_users(),
                        ])
                    else:
                        msg = res.json().get('error', 'Error')
                        self.root.after(0, lambda: fb_lbl.config(text=msg, fg=self.t['red']))
                except Exception:
                    self.root.after(0, lambda: fb_lbl.config(text='Error de conexión', fg=self.t['red']))
            threading.Thread(target=_req, daemon=True).start()

        tk.Button(create_frm, text='Crear usuario', command=create_user,
                  bg=self.t['accent'], fg=self.t['bg'], relief='flat',
                  font=self.f_bold, pady=6, cursor='hand2').pack(fill='x', padx=8, pady=(4, 8))

        # Logout
        tk.Frame(content, bg=self.t['border'], height=1).pack(fill='x', padx=10, pady=6)
        tk.Button(content, text='Cerrar sesión', command=lambda: [dlg.destroy(), self._logout()],
                  bg=self.t['bg2'], fg=self.t['red'], relief='flat',
                  font=self.f_normal, pady=8, cursor='hand2').pack(fill='x', padx=10, pady=(0, 12))

        load_users()

    # ─────────────────────────────────────────────────────────────────────────
    # Canvas helpers
    # ─────────────────────────────────────────────────────────────────────────

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
        try: open(THEME_FILE, 'w').write(new)
        except Exception: pass
        self._apply_theme()

    def _apply_theme(self):
        t = self.t
        self.root.configure(bg=t['bg'])
        self._hdr.configure(bg=t['bg2'])
        self._toggle_btn.configure(bg=t['bg2'], fg=t['text'], text=t['toggle_icon'])
        self._admin_btn.configure(bg=t['bg2'])
        self._canvas.configure(bg=t['bg'])
        self._chat_frame.configure(bg=t['bg'])
        self._bottom.configure(bg=t['bg2'])
        self._preview_frame.configure(bg=t['bg3'])
        self._countdown_lbl.configure(bg=t['bg3'], fg=t['yellow'])
        self._preview_entry.configure(bg=t['bg2'], fg=t['text'], insertbackground=t['text'])
        self._prev_send_btn.configure(bg=t['accent'], fg=t['bg'])
        self._presets_btn.configure(bg=t['btn'], fg=t['text'])
        self._text_entry.configure(bg=t['bg3'], insertbackground=t['text'])
        self._mic_btn.configure(bg=t['btn'], fg=t['text'])
        self._send_btn.configure(bg=t['accent'], fg=t['bg'])
        self._status_bar.configure(bg=t['bg2'], fg=t['status_text'])

        for row, bubble, label, reuse_btn, role in self.msg_widgets:
            row.configure(bg=t['bg'])
            if role == 'status':
                continue
            bk = t[f'{role}_bubble']
            tx = t[f'{role}_text']
            bubble.configure(bg=bk)
            label.configure(bg=bk, fg=tx)
            reuse_btn.configure(bg=bk, fg=t['dim'],
                                activebackground=bk, activeforeground=t['accent'])

        for w in self._hdr.winfo_children():
            if isinstance(w, tk.Label):
                is_title = 'BAKO' in (w.cget('text') or '')
                w.configure(bg=t['bg2'], fg=t['text'] if is_title else t['dim'])

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

        row    = tk.Frame(self._chat_frame, bg=t['bg'])
        row.pack(fill='x', padx=8, pady=3)
        bubble = tk.Frame(row, bg=bk)
        label  = tk.Label(bubble, text=text, bg=bk, fg=tx, font=self.f_normal,
                          wraplength=330, justify='left', padx=10, pady=7)
        label.pack(side='left')
        reuse_btn = tk.Button(bubble, text='↩', bg=bk, fg=t['dim'],
                              relief='flat', font=self.f_small, cursor='hand2',
                              padx=4, pady=2,
                              activebackground=bk, activeforeground=t['accent'],
                              command=lambda txt=text: self._reuse_message(txt))
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
        t   = self.t
        fg  = color or t['status_text']
        row = tk.Frame(self._chat_frame, bg=t['bg'])
        row.pack(fill='x', pady=2)
        tk.Label(row, text=text, bg=t['bg'], fg=fg, font=self.f_small).pack(anchor='center')
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
            # El mic button NO se deshabilita cuando BAKO está activo
            if not self._is_active:
                self._mic_btn.config(
                    state=state,
                    cursor='hand2' if enabled else 'arrow',
                )
            self._send_btn.config(state=state, cursor='hand2' if enabled else 'arrow')
            self._prev_send_btn.config(state=state)
            self._text_entry.config(state=state)
        self.root.after(0, _do)

    # ─────────────────────────────────────────────────────────────────────────
    # Rate limit
    # ─────────────────────────────────────────────────────────────────────────

    def _cooling_down(self) -> bool:
        return time.time() < self.cooldown_until

    def _set_cooldown(self, secs: int):
        self.cooldown_until = time.time() + secs
        def _do():
            for btn in (self._mic_btn, self._send_btn, self._prev_send_btn):
                btn.config(state='disabled', cursor='arrow')
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
        # Si BAKO está activo → interrumpir en lugar de grabar
        if self._is_active:
            self._stop_bako()
            return
        if self._cooling_down() or self.is_recording:
            return
        with self.lock:
            self.is_recording = True
            self.audio_frames = []
        self.root.after(0, lambda: self._mic_btn.config(
            bg='#0d2b0d', text='🔴  Grabando…', fg=self.t['green']))
        self._set_status('🎤 Grabando…', self.t['green'])
        threading.Thread(target=self._record_loop, daemon=True).start()

    def _on_mic_release(self, event=None):
        if not self._is_active:
            with self.lock:
                self.is_recording = False
            self.root.after(0, lambda: self._mic_btn.config(
                bg=self.t['btn'], text='🎤', fg=self.t['text']))

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

            headers = self._get_headers(json_content=False)
            with open(tmp.name, 'rb') as f:
                resp = requests.post(
                    f'{BAKO_URL}/api/desktop/transcribe',
                    headers=headers,
                    files={'audio': ('voice.wav', f, 'audio/wav')},
                    timeout=20,
                )
            os.unlink(tmp.name)

            if resp.status_code == 401:
                self._clear_auth()
                self.root.after(0, lambda: [
                    self._add_status_msg('🔒 Sesión expirada — accede de nuevo', self.t['yellow']),
                    self._show_login_dialog(),
                ])
                return

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
        self.pending_text = text
        self.user_editing = False
        self._preview_var.set(text)
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
        self._cancel_flag.clear()
        self._is_active = True

        self.root.after(0, lambda: self._add_message('user', text))
        self._set_ui_enabled(False)
        self.root.after(0, lambda: self._mic_btn.config(
            bg='#1a1500', text='⏹  Parar', fg=self.t['yellow'],
            state='normal', cursor='hand2',
        ))
        self._set_status('📡 Enviando a BAKO…', self.t['accent'])

        try:
            resp = requests.post(
                f'{BAKO_URL}/api/desktop/text',
                json={'message': text},
                headers=self._get_headers(),
                timeout=60,
            )
            self.last_request_time = time.time()

            # Si el usuario interrumpió mientras esperaba la respuesta
            if self._cancel_flag.is_set():
                self._is_active = False
                return

            if resp.status_code == 401:
                self._is_active = False
                self._clear_auth()
                self.root.after(0, lambda: [
                    self._add_status_msg('🔒 Sesión expirada — accede de nuevo', self.t['yellow']),
                    self._set_ui_enabled(True),
                    self._set_status('✅ Listo'),
                    self._show_login_dialog(),
                ])
                return

            if resp.status_code == 429:
                self._is_active = False
                data = resp.json() if resp.content else {}
                secs = self._parse_cooldown(str(data))
                self._set_cooldown(secs)
                self.root.after(0, lambda: self._add_status_msg(
                    f'🚫 Rate limit — {secs}s', self.t['red']))
                return

            if resp.status_code == 413:
                self._is_active = False
                self.root.after(0, lambda: self._add_status_msg(
                    '⚠️ Contexto muy grande. Intenta de nuevo.', self.t['yellow']))
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')
                return

            if resp.status_code >= 400:
                self._is_active = False
                err = resp.json().get('error', f'Error {resp.status_code}')
                self.root.after(0, lambda: self._add_status_msg(f'⚠️ {err}', self.t['yellow']))
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')
                return

            data          = resp.json()
            response_text = self._strip_md(data.get('response', ''))
            if response_text:
                self.root.after(0, lambda: self._add_message('bako', response_text))

            if 'audio' in data and not self._cancel_flag.is_set():
                self._set_status('🔊 Reproduciendo…', self.t['green'])
                self.root.after(0, lambda: self._mic_btn.config(
                    bg='#0a1a0f', text='⏹  Parar', fg=self.t['green']))
                self._play_audio(data['audio'])
            else:
                self._is_active = False
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')
                self.root.after(0, lambda: self._mic_btn.config(
                    bg=self.t['btn'], text='🎤', fg=self.t['text']))

        except requests.exceptions.ConnectionError:
            self._is_active = False
            self.root.after(0, lambda: self._add_status_msg(
                '⚠️ Sin conexión con BAKO', self.t['red']))
            if not self._cooling_down():
                self._set_ui_enabled(True)
                self._set_status('⚠️ Sin conexión', self.t['red'])
            self.root.after(0, lambda: self._mic_btn.config(
                bg=self.t['btn'], text='🎤', fg=self.t['text']))
        except Exception as e:
            self._is_active = False
            self.root.after(0, lambda: self._add_status_msg(str(e), self.t['red']))
            if not self._cooling_down():
                self._set_ui_enabled(True)
                self._set_status('✅ Listo')
            self.root.after(0, lambda: self._mic_btn.config(
                bg=self.t['btn'], text='🎤', fg=self.t['text']))

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
                    if self._cancel_flag.is_set():
                        pygame.mixer.music.stop()
                        break
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
            try: os.unlink(tmp.name)
            except Exception: pass

        self._is_active = False
        if not self._cooling_down() and not self._cancel_flag.is_set():
            self._set_ui_enabled(True)
            self._set_status('✅ Listo')
        self.root.after(0, lambda: self._mic_btn.config(
            bg=self.t['btn'], text='🎤', fg=self.t['text']))

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
