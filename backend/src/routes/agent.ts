import { Router, Request, Response } from 'express';
import { askClaude } from '../llm/claude';
import { Task } from '../memory/Task';
import { runMorningBriefing } from '../agents/MorningBriefingAgent';

const router = Router();

// POST /api/agent/ask
// Body: { "prompt": "tu pregunta o tarea" }
router.post('/ask', async (req: Request, res: Response) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'El campo prompt es obligatorio' });
    return;
  }

  // 1. Crear el registro en MongoDB antes de llamar al LLM
  const task = await Task.create({ prompt, status: 'pending' });
  console.log(`📨 Tarea guardada [${task._id}]: ${prompt}`);

  try {
    const respuesta = await askClaude(prompt);

    // 2. Marcar como completada con la respuesta
    task.respuesta = respuesta;
    task.status = 'done';
    await task.save();

    console.log(`✅ Tarea completada [${task._id}]`);

    res.json({
      ok: true,
      taskId: task._id,
      prompt,
      respuesta,
    });

  } catch (error) {
    // 3. Si el LLM falla, guardar el error y mantener trazabilidad
    task.status = 'error';
    task.errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    await task.save();

    console.error(`❌ Tarea fallida [${task._id}]:`, error);
    res.status(500).json({ error: 'Error al procesar la tarea', taskId: task._id });
  }
});

// GET /api/agent/tasks — ver el historial de tareas
router.get('/tasks', async (_req: Request, res: Response) => {
  const tasks = await Task.find().sort({ createdAt: -1 }).limit(20);
  res.json({ ok: true, tasks });
});

// POST /api/agent/morning-briefing — ejecutar el Morning Briefing Agent
router.post('/morning-briefing', async (req: Request, res: Response) => {
  const speak = req.body?.speak ?? req.query.speak === 'true';
  const prompt = 'Morning Briefing — clima, noticias y proyectos';
  const task = await Task.create({ prompt, status: 'pending' });
  console.log(`🌅 Morning Briefing iniciado [${task._id}]`);

  try {
    const respuesta = await runMorningBriefing({ speak });

    task.respuesta = respuesta;
    task.status = 'done';
    await task.save();

    console.log(`✅ Morning Briefing completado [${task._id}]`);
    res.json({ ok: true, taskId: task._id, respuesta });

  } catch (error) {
    task.status = 'error';
    task.errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    await task.save();

    console.error(`❌ Morning Briefing fallido [${task._id}]:`, error);
    res.status(500).json({ error: 'Error al generar el briefing', taskId: task._id });
  }
});

export default router;