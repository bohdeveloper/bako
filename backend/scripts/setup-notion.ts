// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TOKEN  = process.env.NOTION_TOKEN!;
const ROOT_PAGE_ID = '3734a5d90b5480698aeeff4ad9066d15';

const api = axios.create({
  baseURL: 'https://api.notion.com/v1',
  headers: {
    Authorization:    `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  },
});

async function createDatabase(pageId: string, title: string, emoji: string, properties: object) {
  const { data } = await api.post('/databases', {
    parent: { type: 'page_id', page_id: pageId },
    icon:   { type: 'emoji', emoji },
    title:  [{ type: 'text', text: { content: title } }],
    properties,
  });
  return data;
}

async function createPage(databaseId: string, properties: object) {
  const { data } = await api.post('/pages', {
    parent: { database_id: databaseId },
    properties,
  });
  return data;
}

async function main() {
  console.log('🚀 Creando estructura BAKO en Notion...\n');

  // Base de datos Tareas
  const tareasDb = await createDatabase(ROOT_PAGE_ID, 'Tareas', '📋', {
    Nombre:           { title: {} },
    Estado: {
      select: {
        options: [
          { name: 'Pendiente',   color: 'yellow' },
          { name: 'En progreso', color: 'blue'   },
          { name: 'Completada',  color: 'green'  },
          { name: 'Bloqueada',   color: 'red'    },
        ],
      },
    },
    Prioridad: {
      select: {
        options: [
          { name: 'Alta',  color: 'red'    },
          { name: 'Media', color: 'yellow' },
          { name: 'Baja',  color: 'gray'   },
        ],
      },
    },
    Proyecto:       { rich_text: {} },
    'Fecha límite': { date: {} },
    Notas:          { rich_text: {} },
  });
  console.log('✅ Base de datos Tareas creada:', tareasDb.id);

  // Base de datos Proyectos
  const proyectosDb = await createDatabase(ROOT_PAGE_ID, 'Proyectos', '💻', {
    Nombre:      { title: {} },
    Estado: {
      select: {
        options: [
          { name: 'Activo',     color: 'green'  },
          { name: 'Pausado',    color: 'yellow' },
          { name: 'Completado', color: 'blue'   },
        ],
      },
    },
    Descripción: { rich_text: {} },
    URL:         { url: {} },
    Stack:       { rich_text: {} },
  });
  console.log('✅ Base de datos Proyectos creada:', proyectosDb.id);

  // Proyectos iniciales
  const proyectos = [
    { nombre: 'BAKO',         estado: 'Activo', desc: 'Asistente personal IA autónomo',           url: null,                stack: 'Node.js + TypeScript + MongoDB' },
    { nombre: 'Diamadmin',    estado: 'Activo', desc: 'SaaS propio — gestión administrativa',     url: 'app.diamadmin.com', stack: 'Angular + Spring Boot + PostgreSQL' },
    { nombre: 'Unyona',       estado: 'Activo', desc: 'SaaS en validación — captura de leads',    url: 'unyona.com',        stack: 'Landing page' },
    { nombre: 'bohdeveloper', estado: 'Activo', desc: 'Portfolio personal con integración BAKO',  url: 'bohdeveloper.com',  stack: 'Next.js + Cloudflare Pages' },
  ];

  for (const p of proyectos) {
    await createPage(proyectosDb.id, {
      Nombre:      { title:     [{ text: { content: p.nombre } }] },
      Estado:      { select:    { name: p.estado } },
      Descripción: { rich_text: [{ text: { content: p.desc   } }] },
      URL:         { url: p.url },
      Stack:       { rich_text: [{ text: { content: p.stack  } }] },
    });
  }
  console.log('✅ Proyectos iniciales creados (4)');

  // Guardar IDs en .env
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent
    .replace('NOTION_TASKS_DB_ID=',    `NOTION_TASKS_DB_ID=${tareasDb.id}`)
    .replace('NOTION_PROJECTS_DB_ID=', `NOTION_PROJECTS_DB_ID=${proyectosDb.id}`);
  fs.writeFileSync(envPath, envContent);

  console.log('\n🎉 Notion listo. IDs guardados en .env:');
  console.log('   Tareas:    ', tareasDb.id);
  console.log('   Proyectos: ', proyectosDb.id);
}

main().catch((err) => {
  console.error('❌', err.response?.data?.message ?? err.message);
  process.exit(1);
});
