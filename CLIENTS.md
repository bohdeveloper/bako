# BAKO — Clientes de acceso

> BAKO es accesible desde tres clientes. Todos conectan al mismo backend en Render.

---

## Telegram (principal)

- Bot activo 24/7 en Render
- Voz + texto + comandos naturales
- No requiere instalación — solo abrir Telegram y buscar el bot

**Comandos principales:**

| Comando | Función |
|---|---|
| `/briefing` | Resumen matutino completo (tiempo, agenda, noticias, proyectos) |
| `/agenda` | Eventos de Google Calendar hoy y próximos días |
| `/email` | Correos sin leer en Gmail |
| `/tiempo` | Tiempo actual y previsión (acepta lenguaje natural: "¿lloverá mañana?") |
| `/tareas` | Issues pendientes en Notion |
| `/tracker` | Resumen diario del Tracker personal |
| `/proyectos` | Actividad GitHub (commits, PRs, issues) |
| `/memorias [tema]` | Buscar o listar memorias de BAKO |
| `/perfil` | Ver/actualizar campos del perfil dinámico |
| `/voz [nombre]` | Cambiar voz TTS (alvaro, elvira, jorge, dalia, tomas, elena) |
| `/personalidad [preset]` | Cambiar personalidad (mayordomo, colega, jarvis) |
| `/automaticos` | Panel de mensajes automáticos con toggles |
| `/llm [auto\|groq\|ollama]` | Forzar modelo LLM |
| `/servicio` | Ver qué LLM está activo (Ollama local o Groq) |
| `/privado <mensaje>` | Procesar mensaje solo en Ollama local (privacidad) |

**Lenguaje natural (sin comandos):**
- "¿Qué tengo hoy?" → agenda + tracker
- "¿Lloverá esta semana?" → previsión 3 días
- "Bako, crea un issue en Unyona: login con Google"
- "Cierra el issue #12 de Diamadmin"
- "Actualiza el siguiente paso de BAKO a búsqueda semántica"
- "Recuérdame en 2 horas revisar el deploy"
- "Redacta un email a Iñaki sobre el informe CE"

---

## PWA — Cliente web v4 (móvil y PC)

URL: `https://ai-personal-os.onrender.com/bako-client/`

### Características

- Chat history con burbujas (usuario derecha verde · BAKO izquierda azul)
- Botón ↩ por mensaje → copia al input para editar y reenviar
- Botón ✕ por mensaje → borra esa burbuja del historial
- Botón 🔊 por burbuja → reproduce/detiene voz de ese mensaje
- Input de texto + botón Enviar (además de voz)
- Revisión de transcripción: 5s countdown + barra de progreso, editable antes de enviar
- Pull-to-refresh: swipe down (≥60px) → refresca notificaciones
- Modo claro/oscuro con toggle luna/sol
- Rate limit: bloquea UI automáticamente con countdown visible
- **Web Push**: notificaciones nativas del SO aunque la app esté cerrada
- Voz automática al tocar una notificación del sistema (gesto del usuario = autoplay permitido)
- Panel admin accesible desde la navbar (login con JWT)

### Instalación en Android (Chrome)

1. Abre Chrome → navega a la URL
2. Menú (⋮) → "Añadir a pantalla de inicio"
3. Se instala como app con icono propio

### Instalación en iOS (Safari)

1. Safari → icono compartir (⬆) → "Añadir a pantalla de inicio"

### Activar Web Push (primera vez en cada dispositivo)

1. Abrir la PWA en el navegador del dispositivo
2. Cuando aparezca el prompt de permisos → Permitir notificaciones
3. La suscripción se guarda en el backend automáticamente
4. A partir de ese momento BAKO puede enviarte notificaciones aunque la app esté cerrada

---

## Script Python — Cliente de escritorio v4 (PC)

Archivo: [bako-desktop/bako_desktop.py](bako-desktop/bako_desktop.py)

### Características

- GUI tkinter con chat history y burbujas (mismo estilo que la PWA)
- Botón ↩ por mensaje → pega texto en el input para reenviar
- Input de texto + botón Enviar
- Modo claro/oscuro con toggle luna/sol
- Revisión de transcripción: 5s countdown, editable
- Rate limit: bloquea botones automáticamente con countdown
- Hotkey global `Ctrl+Alt+B` — abre/oculta la ventana desde cualquier sitio
- Auth JWT — mismas credenciales que la PWA
- Usa Ollama local cuando el PC está encendido

### Instalación (una sola vez)

```bash
cd bako-desktop
pip install -r requirements.txt
```

### Uso diario

```bash
python bako_desktop.py
```

### Configuración (variables de entorno opcionales)

```
BAKO_URL=https://ai-personal-os.onrender.com
DESKTOP_TOKEN=<token>
BAKO_HOTKEY=ctrl+alt+b
```

### Arranque automático con Windows

1. `Win+R` → `shell:startup`
2. Crear acceso directo a `python bako_desktop.py`

---

## App React Native (pendiente — Horizonte 1)

- App nativa Android + iOS
- Wake word "Bako" con pantalla bloqueada
- Acceso completo sin abrir ninguna app
- Las notificaciones Web Push ya funcionan en la PWA como alternativa interim
