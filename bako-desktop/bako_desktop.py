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
        dlg.title('⚙ Administración BAKO')
        dlg.transient(self.root)
        dlg.resizable(True, True)
        w, h = 420, 560
        x = self.root.winfo_x() + (self.root.winfo_width()  - w) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - h) // 2
        dlg.geometry(f'{w}x{h}+{x}+{y}')
        dlg.configure(bg=self.t['bg2'])

        tk.Label(dlg, text='⚙ Administración', font=self.f_bold,
                 bg=self.t['bg2'], fg=self.t['text']).pack(padx=14, pady=(12, 6))

        # ── Tabs ────────────────────────────────────────────────────────────
        tab_bar  = tk.Frame(dlg, bg=self.t['bg2'])
        tab_bar.pack(fill='x', padx=10)
        tab_frames = {}
        active_tab = tk.StringVar(value='users')

        def switch_tab(name):
            active_tab.set(name)
            for n, (btn, frm) in tab_frames.items():
                if n == name:
                    btn.config(fg=self.t['accent'], relief='flat')
                    frm.pack(fill='both', expand=True)
                    if name == 'memories':
                        load_memories()
                    if name == 'people':
                        load_people()
                else:
                    btn.config(fg=self.t['dim'], relief='flat')
                    frm.pack_forget()

        content_area = tk.Frame(dlg, bg=self.t['bg2'])
        content_area.pack(fill='both', expand=True, padx=4, pady=4)

        def make_tab(name, label):
            btn = tk.Button(tab_bar, text=label, bg=self.t['bg2'], fg=self.t['dim'],
                            relief='flat', font=self.f_small, cursor='hand2',
                            command=lambda n=name: switch_tab(n))
            btn.pack(side='left', padx=4, pady=(0, 4))
            frm = tk.Frame(content_area, bg=self.t['bg2'])
            tab_frames[name] = (btn, frm)
            return frm

        # ── Tab Usuarios ─────────────────────────────────────────────────────
        users_tab   = make_tab('users',    '👥 Usuarios')
        _people_tab = make_tab('people',   '👤 Personas')  # noqa — usado en switch_tab

        def _scrollable(parent):
            c  = tk.Canvas(parent, bg=self.t['bg2'], highlightthickness=0)
            sb = tk.Scrollbar(parent, orient='vertical', command=c.yview)
            c.configure(yscrollcommand=sb.set)
            sb.pack(side='right', fill='y')
            c.pack(fill='both', expand=True)
            inner = tk.Frame(c, bg=self.t['bg2'])
            c.create_window((0, 0), window=inner, anchor='nw')
            inner.bind('<Configure>', lambda e: c.configure(scrollregion=c.bbox('all')))
            c.bind_all('<MouseWheel>', lambda e: c.yview_scroll(int(-1*(e.delta/120)), 'units'))
            return inner

        u_inner = _scrollable(users_tab)

        users_frame = tk.Frame(u_inner, bg=self.t['bg2'])
        users_frame.pack(fill='x', padx=10, pady=4)

        def load_users():
            for w in users_frame.winfo_children(): w.destroy()
            tk.Label(users_frame, text='Cargando…', fg=self.t['dim'],
                     bg=self.t['bg2'], font=self.f_small).pack()
            def _req():
                try:
                    r = requests.get(f'{BAKO_URL}/api/auth/users',
                                     headers=self._get_headers(), timeout=10)
                    users = r.json().get('users', []) if r.ok else []
                    self.root.after(0, lambda: render_users(users))
                except Exception:
                    pass
            threading.Thread(target=_req, daemon=True).start()

        def render_users(users):
            for w in users_frame.winfo_children(): w.destroy()
            if not users:
                tk.Label(users_frame, text='Sin usuarios', fg=self.t['dim'],
                         bg=self.t['bg2'], font=self.f_small).pack(); return
            for u in users:
                row  = tk.Frame(users_frame, bg=self.t['bg3'])
                row.pack(fill='x', pady=2)
                info = tk.Frame(row, bg=self.t['bg3'])
                info.pack(side='left', fill='x', expand=True, padx=8, pady=6)
                tk.Label(info, text=u['username'],
                         fg=self.t['text'] if u.get('active') else self.t['dim'],
                         bg=self.t['bg3'], font=self.f_bold).pack(anchor='w')
                tk.Label(info, text=f"{u['role']} · {'activo' if u.get('active') else 'inactivo'}",
                         fg=self.t['dim'], bg=self.t['bg3'], font=self.f_small).pack(anchor='w')
                if u['role'] != 'superadmin':
                    bf = tk.Frame(row, bg=self.t['bg3'])
                    bf.pack(side='right', padx=6)
                    def toggle_user(uid=u['_id']):
                        threading.Thread(target=lambda: [
                            requests.patch(f'{BAKO_URL}/api/auth/users/{uid}/toggle',
                                           headers=self._get_headers(), timeout=10),
                            self.root.after(0, load_users)], daemon=True).start()
                    def delete_user(uid=u['_id'], uname=u['username']):
                        if messagebox.askyesno('Confirmar', f'¿Eliminar "{uname}"?'):
                            threading.Thread(target=lambda: [
                                requests.delete(f'{BAKO_URL}/api/auth/users/{uid}',
                                                headers=self._get_headers(), timeout=10),
                                self.root.after(0, load_users)], daemon=True).start()
                    tk.Button(bf, text='🔒' if u.get('active') else '🔓',
                              bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                              cursor='hand2', command=toggle_user).pack(side='left')
                    tk.Button(bf, text='🗑', bg=self.t['bg3'], fg=self.t['dim'],
                              relief='flat', cursor='hand2', command=delete_user).pack(side='left')

        # Crear usuario
        tk.Frame(u_inner, bg=self.t['border'], height=1).pack(fill='x', padx=10, pady=8)
        cf = tk.Frame(u_inner, bg=self.t['bg3'])
        cf.pack(fill='x', padx=10, pady=(0, 6))
        tk.Label(cf, text='Crear usuario', font=self.f_small,
                 bg=self.t['bg3'], fg=self.t['dim']).pack(anchor='w', padx=8, pady=(6, 4))

        nu_var, np_var, nr_var = tk.StringVar(), tk.StringVar(), tk.StringVar(value='user')
        for ph, var, show in [('Nombre de usuario', nu_var, ''), ('Contraseña', np_var, '●')]:
            tk.Entry(cf, textvariable=var, bg=self.t['bg2'], fg=self.t['text'],
                     relief='flat', font=self.f_normal, insertbackground=self.t['text'],
                     show=show).pack(fill='x', padx=8, ipady=5, pady=2)
        rf = tk.Frame(cf, bg=self.t['bg3'])
        rf.pack(fill='x', padx=8, pady=2)
        for lbl, val in [('Usuario', 'user'), ('Superadmin', 'superadmin')]:
            tk.Radiobutton(rf, text=lbl, variable=nr_var, value=val,
                           bg=self.t['bg3'], fg=self.t['text'], selectcolor=self.t['bg2'],
                           activebackground=self.t['bg3']).pack(side='left', padx=4)
        ufb = tk.Label(cf, text='', bg=self.t['bg3'], font=self.f_small)
        ufb.pack(padx=8)

        def create_user():
            u, p, r = nu_var.get().strip(), np_var.get(), nr_var.get()
            if not u or not p: ufb.config(text='Rellena usuario y contraseña', fg=self.t['red']); return
            def _req():
                try:
                    res = requests.post(f'{BAKO_URL}/api/auth/users',
                                        json={'username': u, 'password': p, 'role': r},
                                        headers=self._get_headers(), timeout=10)
                    if res.ok:
                        self.root.after(0, lambda: [ufb.config(text=f'✓ {u} creado', fg=self.t['green']),
                                                    nu_var.set(''), np_var.set(''), load_users()])
                    else:
                        msg = res.json().get('error', 'Error')
                        self.root.after(0, lambda: ufb.config(text=msg, fg=self.t['red']))
                except Exception:
                    self.root.after(0, lambda: ufb.config(text='Error de conexión', fg=self.t['red']))
            threading.Thread(target=_req, daemon=True).start()

        tk.Button(cf, text='Crear usuario', command=create_user,
                  bg=self.t['accent'], fg=self.t['bg'], relief='flat',
                  font=self.f_bold, pady=6, cursor='hand2').pack(fill='x', padx=8, pady=(4, 8))

        tk.Frame(u_inner, bg=self.t['border'], height=1).pack(fill='x', padx=10, pady=4)
        tk.Button(u_inner, text='Cerrar sesión', command=lambda: [dlg.destroy(), self._logout()],
                  bg=self.t['bg2'], fg=self.t['red'], relief='flat',
                  font=self.f_normal, pady=8, cursor='hand2').pack(fill='x', padx=10, pady=(0, 10))

        # ── Tab Personas ─────────────────────────────────────────────────────
        people_tab = make_tab('people', '👤 Personas')
        p_inner    = _scrollable(people_tab)

        REL_LABELS = {'pareja':'Pareja','familiar':'Familiar','amigo':'Amigo',
                      'compañero':'Compañero','conocido':'Conocido','otro':'Otro'}
        _all_people = []

        # Toolbar personas
        p_toolbar = tk.Frame(p_inner, bg=self.t['bg2'])
        p_toolbar.pack(fill='x', padx=8, pady=(6, 4))
        tk.Button(p_toolbar, text='+ Añadir persona', bg=self.t['accent'], fg=self.t['bg'],
                  relief='flat', font=self.f_small, cursor='hand2',
                  command=lambda: toggle_person_form()).pack(side='right')

        p_list_frame = tk.Frame(p_inner, bg=self.t['bg2'])
        p_list_frame.pack(fill='x', padx=8, pady=4)

        # Formulario crear persona (oculto)
        p_create_frame = tk.Frame(p_inner, bg=self.t['bg3'])
        pf_visible = [False]
        pf_vars = {k: tk.StringVar() for k in ['nombre','descripcion','cumpleaños','ubicacion','trabajo','conexiones','notas']}
        pf_rel  = tk.StringVar(value='amigo')

        def toggle_person_form():
            pf_visible[0] = not pf_visible[0]
            if pf_visible[0]:
                p_create_frame.pack(fill='x', padx=8, pady=4, before=p_list_frame)
                # focus first field
            else:
                p_create_frame.pack_forget()

        tk.Label(p_create_frame, text='Nueva persona', font=self.f_small,
                 bg=self.t['bg3'], fg=self.t['dim']).pack(anchor='w', padx=8, pady=(6,2))

        for ph, key in [('Nombre *','nombre'),('Descripción breve','descripcion'),
                        ('Cumpleaños DD-MM','cumpleaños'),('Dónde vive','ubicacion'),
                        ('Trabajo/profesión','trabajo'),('Conexiones (separar por coma)','conexiones'),
                        ('Notas (separar por ·)','notas')]:
            tk.Entry(p_create_frame, textvariable=pf_vars[key], bg=self.t['bg2'], fg=self.t['text'],
                     relief='flat', font=self.f_small, insertbackground=self.t['text'],
                     width=44).pack(fill='x', padx=8, ipady=4, pady=1)

        rel_frame = tk.Frame(p_create_frame, bg=self.t['bg3'])
        rel_frame.pack(fill='x', padx=8, pady=2)
        tk.Label(rel_frame, text='Relación:', bg=self.t['bg3'], fg=self.t['dim'],
                 font=self.f_small).pack(side='left')
        for lbl, val in REL_LABELS.items():
            tk.Radiobutton(rel_frame, text=val, variable=pf_rel, value=lbl,
                           bg=self.t['bg3'], fg=self.t['text'], selectcolor=self.t['bg2'],
                           activebackground=self.t['bg3'], font=self.f_small).pack(side='left', padx=3)

        pf_fb   = tk.Label(p_create_frame, text='', bg=self.t['bg3'], font=self.f_small)
        pf_fb.pack()
        pf_btns = tk.Frame(p_create_frame, bg=self.t['bg3'])
        pf_btns.pack(fill='x', padx=8, pady=(2, 8))

        def save_person():
            nombre = pf_vars['nombre'].get().strip()
            if not nombre: pf_fb.config(text='El nombre es obligatorio', fg=self.t['red']); return
            body = {
                'nombre':      nombre,
                'relacion':    pf_rel.get(),
                'descripcion': pf_vars['descripcion'].get().strip(),
                'cumpleaños':  pf_vars['cumpleaños'].get().strip(),
                'ubicacion':   pf_vars['ubicacion'].get().strip(),
                'trabajo':     pf_vars['trabajo'].get().strip(),
                'conexiones':  [c.strip() for c in pf_vars['conexiones'].get().split(',') if c.strip()],
                'notas':       [n.strip() for n in pf_vars['notas'].get().split('·') if n.strip()],
            }
            def _req():
                try:
                    r = requests.post(f'{BAKO_URL}/api/people', json=body,
                                      headers=self._get_headers(), timeout=10)
                    if r.ok:
                        for v in pf_vars.values(): v.set('')
                        self.root.after(0, lambda: [pf_fb.config(text=f'✓ {nombre} añadido', fg=self.t['green']),
                                                    load_people()])
                    else:
                        msg = r.json().get('error','Error')
                        self.root.after(0, lambda: pf_fb.config(text=msg, fg=self.t['red']))
                except Exception:
                    self.root.after(0, lambda: pf_fb.config(text='Error de conexión', fg=self.t['red']))
            threading.Thread(target=_req, daemon=True).start()

        tk.Button(pf_btns, text='Guardar', command=save_person,
                  bg=self.t['accent'], fg=self.t['bg'], relief='flat',
                  font=self.f_small, pady=4, cursor='hand2').pack(side='left', padx=(0,6))
        tk.Button(pf_btns, text='Cancelar', command=toggle_person_form,
                  bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                  font=self.f_small, pady=4, cursor='hand2').pack(side='left')

        def load_people():
            for w in p_list_frame.winfo_children(): w.destroy()
            tk.Label(p_list_frame, text='Cargando…', fg=self.t['dim'],
                     bg=self.t['bg2'], font=self.f_small).pack()
            def _req():
                try:
                    r = requests.get(f'{BAKO_URL}/api/people', headers=self._get_headers(), timeout=10)
                    people = r.json().get('people', []) if r.ok else []
                    _all_people.clear(); _all_people.extend(people)
                    self.root.after(0, lambda: render_people(people))
                except Exception:
                    pass
            threading.Thread(target=_req, daemon=True).start()

        def render_people(people):
            for w in p_list_frame.winfo_children(): w.destroy()
            if not people:
                tk.Label(p_list_frame, text='Sin personas registradas', fg=self.t['dim'],
                         bg=self.t['bg2'], font=self.f_small).pack(pady=12)
                return
            for p in people:
                build_person_card(p)

        def build_person_card(p):
            card = tk.Frame(p_list_frame, bg=self.t['bg3'])
            card.pack(fill='x', pady=3)

            header = tk.Frame(card, bg=self.t['bg3'])
            header.pack(fill='x', padx=10, pady=(8, 2))

            rel_lbl = REL_LABELS.get(p.get('relacion',''), p.get('relacion',''))
            name_text = f"{p['nombre']}  [{rel_lbl}]"
            tk.Label(header, text=name_text, fg=self.t['text'],
                     bg=self.t['bg3'], font=self.f_bold).pack(side='left')

            actions = tk.Frame(header, bg=self.t['bg3'])
            actions.pack(side='right')

            def edit_person(person=p, c=card):
                toggle_person_edit(person, c)
            def del_person(pid=p['_id'], c=card):
                if messagebox.askyesno('Confirmar', f'¿Eliminar a {p["nombre"]}?'):
                    def _req():
                        requests.delete(f'{BAKO_URL}/api/people/{pid}',
                                        headers=self._get_headers(), timeout=10)
                        self.root.after(0, load_people)
                    threading.Thread(target=_req, daemon=True).start()

            tk.Button(actions, text='✏️', bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                      cursor='hand2', font=self.f_small, command=edit_person).pack(side='left')
            tk.Button(actions, text='🗑', bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                      cursor='hand2', font=self.f_small, command=del_person).pack(side='left')

            # Meta info
            meta_parts = []
            if p.get('descripcion'): meta_parts.append(p['descripcion'])
            if p.get('cumpleaños'): meta_parts.append(f"🎂 {p['cumpleaños']}")
            if p.get('ubicacion'):  meta_parts.append(f"📍 {p['ubicacion']}")
            if p.get('trabajo'):    meta_parts.append(f"💼 {p['trabajo']}")
            if meta_parts:
                tk.Label(card, text='  '.join(meta_parts), fg=self.t['dim'],
                         bg=self.t['bg3'], font=self.f_small,
                         wraplength=360, anchor='w').pack(fill='x', padx=10, pady=(0, 4))

            if p.get('notas'):
                tk.Label(card, text=' · '.join(p['notas']), fg=self.t['dim'],
                         bg=self.t['bg3'], font=self.f_small,
                         wraplength=360, anchor='w').pack(fill='x', padx=10, pady=(0, 6))

        def toggle_person_edit(p, card):
            existing = getattr(card, '_edit_frame', None)
            if existing and existing.winfo_exists():
                existing.destroy(); card._edit_frame = None; return

            ef = tk.Frame(card, bg=self.t['bg2'])
            ef.pack(fill='x', padx=10, pady=(0, 8))
            card._edit_frame = ef

            ev = {k: tk.StringVar() for k in ['nombre','descripcion','cumpleaños','ubicacion','trabajo','conexiones','notas']}
            ev['nombre'].set(p.get('nombre',''))
            ev['descripcion'].set(p.get('descripcion',''))
            ev['cumpleaños'].set(p.get('cumpleaños',''))
            ev['ubicacion'].set(p.get('ubicacion',''))
            ev['trabajo'].set(p.get('trabajo',''))
            ev['conexiones'].set(', '.join(p.get('conexiones',[])))
            ev['notas'].set(' · '.join(p.get('notas',[])))
            e_rel = tk.StringVar(value=p.get('relacion','amigo'))

            for ph, key in [('Nombre','nombre'),('Descripción','descripcion'),
                            ('Cumpleaños DD-MM','cumpleaños'),('Ubicación','ubicacion'),
                            ('Trabajo','trabajo'),('Conexiones','conexiones'),('Notas (·)','notas')]:
                tk.Entry(ef, textvariable=ev[key], bg=self.t['bg2'], fg=self.t['text'],
                         relief='flat', font=self.f_small, insertbackground=self.t['text']).pack(fill='x', ipady=4, pady=1)

            e_fb = tk.Label(ef, text='', bg=self.t['bg2'], font=self.f_small)
            e_fb.pack()
            e_btns = tk.Frame(ef, bg=self.t['bg2'])
            e_btns.pack(fill='x', pady=(2,0))

            def do_save():
                body = {
                    'nombre':      ev['nombre'].get().strip(),
                    'relacion':    e_rel.get(),
                    'descripcion': ev['descripcion'].get().strip(),
                    'cumpleaños':  ev['cumpleaños'].get().strip(),
                    'ubicacion':   ev['ubicacion'].get().strip(),
                    'trabajo':     ev['trabajo'].get().strip(),
                    'conexiones':  [c.strip() for c in ev['conexiones'].get().split(',') if c.strip()],
                    'notas':       [n.strip() for n in ev['notas'].get().split('·') if n.strip()],
                }
                if not body['nombre']: return
                def _req():
                    try:
                        r = requests.put(f'{BAKO_URL}/api/people/{p["_id"]}', json=body,
                                         headers=self._get_headers(), timeout=10)
                        if r.ok:
                            p.update(r.json().get('person', {}))
                            self.root.after(0, load_people)
                        else:
                            msg = r.json().get('error','Error')
                            self.root.after(0, lambda: e_fb.config(text=msg, fg=self.t['red']))
                    except Exception:
                        self.root.after(0, lambda: e_fb.config(text='Error de conexión', fg=self.t['red']))
                threading.Thread(target=_req, daemon=True).start()

            tk.Button(e_btns, text='Guardar', command=do_save,
                      bg=self.t['accent'], fg=self.t['bg'], relief='flat',
                      font=self.f_small, pady=4, cursor='hand2').pack(side='left', padx=(0,6))
            tk.Button(e_btns, text='Cancelar', command=ef.destroy,
                      bg=self.t['bg2'], fg=self.t['dim'], relief='flat',
                      font=self.f_small, pady=4, cursor='hand2').pack(side='left')

        # ── Tab Memorias ─────────────────────────────────────────────────────
        mem_tab     = make_tab('memories', '🧠 Memorias')

        SOCIAL_T  = {'familia','amigos','familia-politica','pareja','suegros','cuniada','cuniado','hermana','padre','madre','padres','yaimy','paula','julen','ibon','sofi','nati','elena','oscar','osvaldo'}
        PROJECT_T = {'bako','diamadmin','unyona','kefir','ai-personal-os','matrix-game','bohdeveloper','ingresos-pasivos','robotica','busqueda-empleo','proyectos'}
        PERSONAL_T= {'salud','gustos','historia','motivacion','valores','objetivos','finanzas','caracter','rutina','entrenamiento','lae','correccion','judicial','psicologo','hobbies','suenos','miedos','transformacion'}
        TIER_COLOR= {'social': '#4a9eff', 'project': '#f59e0b', 'personal': '#10b981', 'tech': '#a78bfa'}
        TIER_LBL  = {'social': '🔵 Social', 'project': '🟠 Proyecto', 'personal': '🟢 Personal', 'tech': '🟣 Técnico'}
        IMP_COLOR = {'high': '#f87171', 'medium': '#fbbf24', 'low': '#9ca3af'}

        def mem_tier(m):
            tags = set(m.get('tags', []))
            if tags & SOCIAL_T:   return 'social'
            if tags & PROJECT_T:  return 'project'
            if tags & PERSONAL_T: return 'personal'
            return 'tech'

        _all_mems   = []
        _mem_page   = [20]
        _search_var = tk.StringVar()
        _tier_var   = tk.StringVar(value='')
        _imp_var    = tk.StringVar(value='')

        # Toolbar
        toolbar = tk.Frame(mem_tab, bg=self.t['bg2'])
        toolbar.pack(fill='x', padx=8, pady=(6, 4))

        tk.Entry(toolbar, textvariable=_search_var, bg=self.t['bg3'], fg=self.t['text'],
                 relief='flat', font=self.f_small, insertbackground=self.t['text'],
                 width=18).pack(side='left', ipady=5, padx=(0, 4))
        tk.Label(toolbar, text='🔍', bg=self.t['bg2'], fg=self.t['dim'],
                 font=self.f_small).place_forget()  # placeholder

        for var, opts in [(_tier_var, ['', 'social', 'project', 'personal', 'tech']),
                          (_imp_var,  ['', 'high', 'medium', 'low'])]:
            om = tk.OptionMenu(toolbar, var, *opts)
            om.config(bg=self.t['bg3'], fg=self.t['text'], relief='flat',
                      font=self.f_small, highlightthickness=0, width=7)
            om.pack(side='left', padx=(0, 4))

        stats_lbl = tk.Label(mem_tab, text='', fg=self.t['dim'],
                             bg=self.t['bg2'], font=self.f_small, anchor='w')
        stats_lbl.pack(fill='x', padx=10, pady=(0, 4))

        # Lista scrollable
        m_canvas = tk.Canvas(mem_tab, bg=self.t['bg2'], highlightthickness=0)
        m_sb     = tk.Scrollbar(mem_tab, orient='vertical', command=m_canvas.yview)
        m_canvas.configure(yscrollcommand=m_sb.set)
        m_sb.pack(side='right', fill='y')
        m_canvas.pack(fill='both', expand=True, padx=4)
        m_inner = tk.Frame(m_canvas, bg=self.t['bg2'])
        m_canvas.create_window((0, 0), window=m_inner, anchor='nw')
        m_inner.bind('<Configure>', lambda e: m_canvas.configure(scrollregion=m_canvas.bbox('all')))

        btn_new_mem = tk.Button(toolbar, text='+ Nueva', bg=self.t['accent'], fg=self.t['bg'],
                                relief='flat', font=self.f_small, cursor='hand2',
                                command=lambda: toggle_create_form())
        btn_new_mem.pack(side='right')

        # Formulario crear memoria (oculto por defecto)
        create_mem_frame = tk.Frame(mem_tab, bg=self.t['bg3'])
        nm_content = tk.Text(create_mem_frame, bg=self.t['bg2'], fg=self.t['text'],
                             relief='flat', font=self.f_normal, height=3,
                             insertbackground=self.t['text'], wrap='word')
        nm_content.pack(fill='x', padx=8, pady=(8, 4))
        nm_row = tk.Frame(create_mem_frame, bg=self.t['bg3'])
        nm_row.pack(fill='x', padx=8, pady=2)
        nm_imp = tk.StringVar(value='medium')
        nm_type = tk.StringVar(value='fact')
        for var, opts in [(nm_imp, ['high','medium','low']), (nm_type, ['fact','preference','project_update','decision','feeling'])]:
            om = tk.OptionMenu(nm_row, var, *opts)
            om.config(bg=self.t['bg3'], fg=self.t['text'], relief='flat', font=self.f_small, highlightthickness=0)
            om.pack(side='left', padx=(0, 4))
        nm_tags = tk.Entry(nm_row, bg=self.t['bg2'], fg=self.t['text'], relief='flat',
                           font=self.f_small, insertbackground=self.t['text'])
        nm_tags.insert(0, 'Tags: familia, yaimy…')
        nm_tags.pack(side='left', fill='x', expand=True)
        nm_fb = tk.Label(create_mem_frame, text='', bg=self.t['bg3'], font=self.f_small)
        nm_fb.pack(padx=8)
        nm_btns = tk.Frame(create_mem_frame, bg=self.t['bg3'])
        nm_btns.pack(fill='x', padx=8, pady=(2, 8))
        _create_visible = [False]

        def toggle_create_form():
            _create_visible[0] = not _create_visible[0]
            if _create_visible[0]:
                create_mem_frame.pack(fill='x', padx=8, pady=4, before=stats_lbl)
                nm_content.focus()
            else:
                create_mem_frame.pack_forget()

        def save_new_mem():
            content = nm_content.get('1.0', 'end').strip()
            tags    = [t.strip() for t in nm_tags.get().replace('Tags: familia, yaimy…','').split(',') if t.strip()]
            if not content: nm_fb.config(text='El contenido es obligatorio', fg=self.t['red']); return
            def _req():
                try:
                    r = requests.post(f'{BAKO_URL}/api/agent/memories/import',
                                      json={'memories': [{'content': content, 'type': nm_type.get(),
                                                          'importance': nm_imp.get(), 'tags': tags}]},
                                      headers=self._get_headers(), timeout=10)
                    if r.ok:
                        self.root.after(0, lambda: [nm_fb.config(text='✓ Guardada', fg=self.t['green']),
                                                    nm_content.delete('1.0','end'), load_memories()])
                    else:
                        self.root.after(0, lambda: nm_fb.config(text='Error', fg=self.t['red']))
                except Exception:
                    self.root.after(0, lambda: nm_fb.config(text='Error de conexión', fg=self.t['red']))
            threading.Thread(target=_req, daemon=True).start()

        tk.Button(nm_btns, text='Guardar', command=save_new_mem,
                  bg=self.t['accent'], fg=self.t['bg'], relief='flat',
                  font=self.f_small, pady=4, cursor='hand2').pack(side='left', padx=(0,6))
        tk.Button(nm_btns, text='Cancelar', command=toggle_create_form,
                  bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                  font=self.f_small, pady=4, cursor='hand2').pack(side='left')

        def filtered_mems():
            q    = _search_var.get().lower()
            tier = _tier_var.get()
            imp  = _imp_var.get()
            return [m for m in _all_mems
                    if (not q    or q in m['content'].lower() or any(q in t for t in m.get('tags',[])))
                    and (not tier or mem_tier(m) == tier)
                    and (not imp  or m.get('importance') == imp)]

        def render_memories():
            for w in m_inner.winfo_children(): w.destroy()
            mems    = filtered_mems()
            visible = mems[:_mem_page[0]]

            # Stats
            counts  = {'social':0,'project':0,'personal':0,'tech':0}
            for m in _all_mems: counts[mem_tier(m)] += 1
            stats_lbl.config(text=f"{len(_all_mems)} memorias  🔵{counts['social']}  🟠{counts['project']}  🟢{counts['personal']}  🟣{counts['tech']}")

            if not mems:
                tk.Label(m_inner, text='Sin resultados', fg=self.t['dim'],
                         bg=self.t['bg2'], font=self.f_small).pack(pady=16)
                return

            for m in visible:
                build_mem_item(m)

            if len(mems) > _mem_page[0]:
                rem = len(mems) - _mem_page[0]
                tk.Button(m_inner, text=f'Cargar más ({rem} restantes)',
                          bg=self.t['bg3'], fg=self.t['dim'], relief='flat',
                          font=self.f_small, pady=6, cursor='hand2',
                          command=lambda: [_mem_page.__setitem__(0, _mem_page[0]+20), render_memories()]
                          ).pack(fill='x', padx=8, pady=4)

        def build_mem_item(m):
            tier  = mem_tier(m)
            frame = tk.Frame(m_inner, bg=self.t['bg3'])
            frame.pack(fill='x', padx=6, pady=3)

            top = tk.Frame(frame, bg=self.t['bg3'])
            top.pack(fill='x', padx=8, pady=(6, 2))

            # Contenido (wraplength dinámico)
            lbl = tk.Label(top, text=m['content'][:120] + ('…' if len(m['content'])>120 else ''),
                           bg=self.t['bg3'], fg=self.t['text'], font=self.f_small,
                           wraplength=260, justify='left', anchor='w')
            lbl.pack(side='left', fill='x', expand=True)

            btn_row = tk.Frame(top, bg=self.t['bg3'])
            btn_row.pack(side='right')
            tk.Button(btn_row, text='✏️', bg=self.t['bg3'], fg=self.t['dim'],
                      relief='flat', cursor='hand2', font=self.f_small,
                      command=lambda: toggle_edit(m, frame)).pack(side='left')
            tk.Button(btn_row, text='🗑', bg=self.t['bg3'], fg=self.t['dim'],
                      relief='flat', cursor='hand2', font=self.f_small,
                      command=lambda mid=m['_id'], f=frame: delete_mem(mid, f)).pack(side='left')

            meta = tk.Frame(frame, bg=self.t['bg3'])
            meta.pack(fill='x', padx=8, pady=(0, 6))
            for badge_text, color in [
                (TIER_LBL[tier], TIER_COLOR[tier]),
                (m.get('importance',''), IMP_COLOR.get(m.get('importance',''), self.t['dim'])),
            ]:
                tk.Label(meta, text=badge_text, bg=self.t['bg3'], fg=color,
                         font=self.f_small).pack(side='left', padx=(0, 6))
            for tag in (m.get('tags') or [])[:4]:
                tk.Label(meta, text=tag, bg=self.t['bg2'], fg=self.t['dim'],
                         font=self.f_small).pack(side='left', padx=(0, 4))

        def toggle_edit(m, frame):
            existing = getattr(frame, '_edit_form', None)
            if existing and existing.winfo_exists():
                existing.destroy()
                frame._edit_form = None
                return

            ef = tk.Frame(frame, bg=self.t['bg2'])
            ef.pack(fill='x', padx=8, pady=(0, 6))
            frame._edit_form = ef

            txt = tk.Text(ef, bg=self.t['bg2'], fg=self.t['text'], relief='flat',
                          font=self.f_small, height=4, insertbackground=self.t['text'], wrap='word')
            txt.insert('1.0', m['content'])
            txt.pack(fill='x', pady=(4, 4))

            row = tk.Frame(ef, bg=self.t['bg2'])
            row.pack(fill='x', pady=2)
            e_imp  = tk.StringVar(value=m.get('importance','medium'))
            e_type = tk.StringVar(value=m.get('type','fact'))
            for var, opts in [(e_imp, ['high','medium','low']), (e_type, ['fact','preference','project_update','decision','feeling'])]:
                om = tk.OptionMenu(row, var, *opts)
                om.config(bg=self.t['bg2'], fg=self.t['text'], relief='flat', font=self.f_small, highlightthickness=0)
                om.pack(side='left', padx=(0,4))
            e_tags = tk.Entry(row, bg=self.t['bg2'], fg=self.t['text'], relief='flat',
                              font=self.f_small, insertbackground=self.t['text'])
            e_tags.insert(0, ', '.join(m.get('tags',[])))
            e_tags.pack(side='left', fill='x', expand=True)

            e_fb = tk.Label(ef, text='', bg=self.t['bg2'], font=self.f_small)
            e_fb.pack()

            def save_edit():
                body = {'content': txt.get('1.0','end').strip(),
                        'importance': e_imp.get(), 'type': e_type.get(),
                        'tags': e_tags.get()}
                if not body['content']: return
                def _req():
                    try:
                        r = requests.put(f'{BAKO_URL}/api/agent/memories/{m["_id"]}',
                                         json=body, headers=self._get_headers(), timeout=10)
                        if r.ok:
                            updated = r.json().get('memory', {})
                            m.update(updated)
                            self.root.after(0, lambda: [ef.destroy(), render_memories()])
                        else:
                            msg = r.json().get('error','Error')
                            self.root.after(0, lambda: e_fb.config(text=msg, fg=self.t['red']))
                    except Exception:
                        self.root.after(0, lambda: e_fb.config(text='Error de conexión', fg=self.t['red']))
                threading.Thread(target=_req, daemon=True).start()

            act = tk.Frame(ef, bg=self.t['bg2'])
            act.pack(fill='x', pady=(2,0))
            tk.Button(act, text='Guardar', command=save_edit,
                      bg=self.t['accent'], fg=self.t['bg'], relief='flat',
                      font=self.f_small, pady=4, cursor='hand2').pack(side='left', padx=(0,6))
            tk.Button(act, text='Cancelar', command=ef.destroy,
                      bg=self.t['bg2'], fg=self.t['dim'], relief='flat',
                      font=self.f_small, pady=4, cursor='hand2').pack(side='left')

        def delete_mem(mid, frame):
            if not messagebox.askyesno('Confirmar', '¿Eliminar esta memoria?'): return
            def _req():
                requests.delete(f'{BAKO_URL}/api/agent/memories/{mid}',
                                headers=self._get_headers(), timeout=10)
                _all_mems[:] = [m for m in _all_mems if m['_id'] != mid]
                self.root.after(0, render_memories)
            threading.Thread(target=_req, daemon=True).start()

        def load_memories():
            stats_lbl.config(text='Cargando…')
            def _req():
                try:
                    r = requests.get(f'{BAKO_URL}/api/agent/memories',
                                     headers=self._get_headers(), timeout=15)
                    mems = r.json().get('memories', []) if r.ok else []
                    _all_mems.clear()
                    _all_mems.extend(mems)
                    _mem_page[0] = 20
                    self.root.after(0, render_memories)
                except Exception:
                    self.root.after(0, lambda: stats_lbl.config(text='Error al cargar memorias'))
            threading.Thread(target=_req, daemon=True).start()

        _search_var.trace_add('write', lambda *_: render_memories())
        _tier_var.trace_add('write',   lambda *_: render_memories())
        _imp_var.trace_add('write',    lambda *_: render_memories())

        # ── Arrancar ────────────────────────────────────────────────────────
        switch_tab('users')
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
