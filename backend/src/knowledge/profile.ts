export const BAKO_PROFILE = {
  identidad: {
    nombre: "Borja",
    edad: 34,
    cumpleanos: "12 de julio (cumple 35 en 2025)",
    ubicacion: "Errentería, Gipuzkoa, País Vasco, España",
    empleador: "Inetum",
    oficina: "Donostia-San Sebastián",
  },

  perfil_tecnico: {
    rol: "Developer Fullstack — orientado a arquitectura de sistemas",
    stack: {
      frontend: ["React", "Angular", "Next.js", "Tailwind CSS", "TypeScript"],
      backend: ["Express.js", "Spring Boot", "Node.js"],
      bases_datos: ["MongoDB", "PostgreSQL"],
      devops: ["Cloudflare Pages", "Docker básico", "Git", "GitHub"],
    },
    aprendiendo: ["Agentes IA", "Ollama", "Machine Learning", "Python para IA"],
    fortalezas: [
      "Mentalidad arquitecto — diseña sistemas complejos con visión global",
      "Fullstack moderno sin dependencias externas",
      "Visión producto — no solo código, piensa en el negocio",
    ],
  },

  proyectos: {
    bako: {
      nombre: "BAKO (Borja's Autonomous Knowledge Operator)",
      descripcion: "Sistema operativo personal con IA — asistente autónomo, voz, Telegram, GitHub",
      estado: "MVP en producción en Render",
    },
    bohdeveloper: {
      nombre: "bohdeveloper.com",
      tipo: "Portfolio personal",
      stack: "Next.js + Cloudflare Pages + Cloudflare D1",
      estado: "Activo — desarrollo continuo",
      seccion_admin: "bohdeveloper.com/admin — panel privado con Tracker diario y gestor del blog",
    },
    kronoshin: {
      nombre: "Kronoshin",
      tipo: "App de tracker diario de hábitos y actividades — dentro de bohdeveloper.com/admin",
      descripcion: "Herramienta de rutina diaria. Define actividades con franja horaria (meditación, entrenamiento, Biziki, proyectos...). Borja marca si las completó o no, y opcionalmente registra el motivo si no las hizo. Los datos se almacenan en Cloudflare D1 y son accesibles desde BAKO.",
      como_funciona: "Cada día tiene un conjunto de tareas según el día de la semana. Al final del día Borja registra el estado de cada actividad.",
      integracion_bako: "BAKO puede consultar las tareas del día, su estado, y marcar actividades como completadas o no completadas.",
      estado: "En producción — uso diario",
    },
    diamadmin: {
      nombre: "Diamadmin",
      tipo: "SaaS propio",
      stack: "Angular + Spring Boot + PostgreSQL",
      urls: ["app.diamadmin.com", "diamadmin.com"],
      estado: "En desarrollo activo con roadmap definido",
    },
    unyona: {
      nombre: "Unyona",
      tipo: "SaaS en validación",
      url: "unyona.com",
      estado: "Landing para capturar leads antes de construir el producto",
    },
    nitflex: {
      nombre: "Nitflex",
      tipo: "App streaming — proyecto portfolio",
      stack: "React + TypeScript + Express + MongoDB + TMDB API",
      estado: "Home screen funcionando",
    },
    ia_autonoma: {
      nombre: "Proyecto IA Autónoma (JARVIS personal)",
      objetivo: "IA autónoma con cuerpo robótico. Nivel JARVIS de Iron Man.",
      horizonte: "3-5 años",
      estado: "Fase 1 — fundamentos ML",
      nota: "Proyecto personal — no comunicado en Inetum",
    },
  },

  vida_personal: {
    filosofia: "Estoicismo — Marcus Aurelius, Jonas Salzgeber. Disciplina diaria, control de lo que depende de uno.",
    entrenamiento: {
      arte_marcial: "Shaolin autodidacta",
      lugar: "Fuerte de Arramendi",
      running: "Grupo BIZIKI — zona Donostia-Errentería",
    },
    rutina_diaria: [
      "05:30 — Despertar",
      "Meditación 20 minutos (Insight Timer)",
      "Entrenamiento matutino",
      "08:00-14:00 — Trabajo en Inetum",
      "19:00-21:00 — Entrenamiento técnica / BIZIKI",
      "21:30 — Dormir",
    ],
    busqueda_vivienda: {
      estado: "Buscando activamente para reubicación",
      zona_objetivo: "Galicia — dentro de ~30km de Pontevedra Y Vigo simultáneamente",
      requisitos: ["Pet-friendly", "Espacio exterior", "Fibra óptica"],
      zonas_candidatas: ["Caldas de Reis (top)", "Cerdedo-Cotobade", "Cuntis", "A Estrada", "Ponte Caldelas"],
    },
  },

  infraestructura: {
    descripcion: "Backend en Render (cloud, 24/7) con Ollama local via Cloudflare Tunnel cuando el PC esta encendido",
    llm_local: "Ollama qwen2.5-coder:7b — sin limites, privado, gratuito. Arranca solo con el PC.",
    llm_nube: "Groq llama-3.1-8b-instant — fallback automatico cuando Ollama no esta disponible",
    tunel: "Cloudflare Tunnel 'bako-ollama' via Task Scheduler. Al apagar PC el tunel cae y Render vuelve a Groq sin cortes.",
    selector_llm: "Borja puede ordenar '/llm ollama', '/llm groq' o '/llm auto' para cambiar manualmente",
    estado_actual: "Tunel activo = Ollama (sin limites). Tunel caido = Groq (limites aplican). Ver /servicio y /limites",
    limites_groq: {
      contexto: "Solo aplican cuando el PC esta apagado y Ollama no esta disponible",
      chat_llm: "llama-3.1-8b-instant: 20.000 tokens/minuto, 14.400 peticiones/dia, reset a medianoche UTC",
      voz_whisper: "whisper-large-v3-turbo: 20 peticiones/minuto, ~33 minutos de audio/dia (2.000 segundos)",
      consejo_pc_apagado: "Espaciar mensajes de voz. Preferir texto para consultas rapidas. Reservar voz para lo que lo necesite.",
      reset_diario: "Medianoche UTC = 01:00 hora de Espana (02:00 en verano)",
    },
  },

  instrucciones_para_bako: {
    trato: "Tratar siempre de señor. Nunca usar el nombre directamente.",
    estilo: "Directo, sin relleno, máximo 3 frases por respuesta.",
    prioridad: "No inventar información. Si no hay datos reales, decirlo.",
    contexto_laboral: "No mezclar proyectos personales con Inetum — son mundos separados.",
  },
};
