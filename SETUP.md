# BAKO — Guía de instalación en máquina nueva

> Lee esto antes de tocar nada. Cada paso tiene un motivo.

---

## Requisitos base (ambas máquinas)

```bash
# Node.js 20+
winget install OpenJS.NodeJS.LTS

# Ollama (para LLM local)
winget install Ollama.Ollama
ollama pull qwen2.5-coder:7b
```

---

## 1. Clonar y preparar el proyecto

```bash
git clone https://github.com/bohdeveloper/ai-personal-os.git
cd ai-personal-os/backend
npm install
```

---

## 2. Configurar el .env

```bash
cp .env.example .env
```

Abre `.env` y rellena las variables vacías. La mayoría son fijas — ver tabla:

| Variable | Valor fijo | Dónde obtenerlo si se pierde |
|---|---|---|
| `MONGODB_URI` | ✅ En .env.example | MongoDB Atlas → Connect → Drivers |
| `DBUSERNAME` / `DBPASSWORD` | ✅ En .env.example | MongoDB Atlas → Database Access |
| `TELEGRAM_BOT_TOKEN` | ✅ En .env.example | @BotFather en Telegram |
| `TELEGRAM_CHAT_ID` | ✅ En .env.example | Enviar /start al bot |
| `GITHUB_TOKEN` | ✅ En .env.example | github.com → Settings → Developer Settings → PAT |
| `GROQ_API_KEY` | ❗ Regenerar | console.groq.com → API Keys (límite por cuenta, no por clave) |
| `NOTION_TOKEN` | ✅ En .env.example | notion.so/my-integrations |
| `NOTION_TASKS_DB_ID` | ✅ Hardcodeado | Fijo — ya creadas las BBDDs |
| `NOTION_PROJECTS_DB_ID` | ✅ Hardcodeado | Fijo — ya creadas las BBDDs |
| `CLOUDFLARE_API_TOKEN` | ❗ Rotar si no visible | dash.cloudflare.com → API Tokens → bako-token → Roll |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ Hardcodeado | Fijo |
| `CLOUDFLARE_D1_DB_ID` | ✅ Hardcodeado | Fijo |
| `GOOGLE_CLIENT_ID` | ✅ Hardcodeado | Fijo |
| `GOOGLE_CLIENT_SECRET` | ✅ Hardcodeado | Fijo |
| `GOOGLE_TOKEN_JSON` | ✅ En .env casa | Ver nota abajo |

### Google Calendar Token

El `GOOGLE_TOKEN_JSON` contiene el token OAuth. Se genera una vez y se renueva automáticamente vía `refresh_token` (no caduca salvo que se revoque manualmente).

**Cómo obtenerlo si no está en .env:**
```bash
# En el PC donde ya está autorizado:
cat backend/token.json   # copiar el contenido completo (una línea)
# Pegar como GOOGLE_TOKEN_JSON= en el .env de la nueva máquina
```

**Si nunca se ha generado:**
```bash
# Necesitas credentials.json descargado de Google Cloud Console
cd backend
npx ts-node scripts/auth-google.ts
# Abre URL en navegador → autoriza → se genera token.json
# Luego copiar su contenido a GOOGLE_TOKEN_JSON en .env
```

---

## 3. Configuración específica por máquina

### PC del trabajo (solo desarrollo, sin Ollama local)

```bash
# No necesitas OLLAMA_URL — deja la variable comentada
# BAKO usará Groq como LLM automáticamente
npm run dev
```

### PC de casa (con Ollama local vía Cloudflare Tunnel)

**Prerrequisitos (solo la primera vez):**
```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login                                          # abre navegador
cloudflared tunnel create bako-ollama
cloudflared tunnel route dns bako-ollama ollama.bohdeveloper.com
```

**Setup autostart (ejecutar el script):**
```powershell
# PowerShell normal (NO administrador)
cd ai-personal-os/backend
.\scripts\setup-windows-autostart.ps1
```

**Añadir en .env:**
```
OLLAMA_URL=https://ollama.bohdeveloper.com
```

**Añadir en Render Dashboard:**
```
OLLAMA_URL=https://ollama.bohdeveloper.com
```

---

## 4. Verificación final

```bash
npm run dev
# Debe mostrar:
# ✅ MongoDB conectado
# 🤖 BAKO Telegram activo
# 📡 BAKO Proactividad activa
```

**Desde Telegram:**
- `/servicio` → debe decir qué LLM está usando
- `/tiempo` → debe responder con el tiempo de Errentería

---

## 5. Credenciales en Render (producción)

Render necesita estas variables adicionales en su dashboard:

```
GOOGLE_TOKEN_JSON=<contenido de token.json en una línea>
OLLAMA_URL=https://ollama.bohdeveloper.com
```

Las demás ya deben estar configuradas desde el setup inicial.

---

## Notas importantes

- **Groq 429**: es límite por **cuenta**, no por clave. Nueva clave = mismo límite. Solución: nueva cuenta o esperar a medianoche UTC.
- **Cloudflare bako-token**: si no puedes ver el valor, haz Roll desde dash.cloudflare.com/profile/api-tokens.
- **Dos instancias del bot Telegram**: NUNCA correr el backend local en paralelo con Render. Causa mensajes duplicados y errores. El backend local es solo para desarrollo con `npm run dev`, no con PM2.
- **token.json**: contiene un `refresh_token` que no caduca. Si lo pierdes, corre `auth-google.ts` de nuevo.
