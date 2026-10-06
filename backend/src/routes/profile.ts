import { Router, Request, Response } from 'express';
import { requireSuperAdmin } from '../middleware/authMiddleware';
import { sanitizeString } from '../middleware/security';
import { PROFILE_FIELDS, getProfileOverrides, updateProfileField } from '../tools/profileDynamic';

const router = Router();
router.use(requireSuperAdmin); // panel de administración: solo superadmin

// GET /api/profile - B6: campos de identidad minima (B2.2) con su valor actual,
// para la pestana "Perfil" del panel - hasta ahora solo se podian leer/editar
// por Telegram (/perfil), sin ninguna vista en el panel de administracion.
router.get('/', async (_req: Request, res: Response) => {
  const overrides = await getProfileOverrides();
  const fields = Object.entries(PROFILE_FIELDS).map(([key, meta]) => ({
    key,
    label: meta.label,
    example: meta.example,
    immutable: !!meta.immutable,
    value: overrides[key] ?? '',
  }));
  res.json({ ok: true, fields });
});

// PATCH /api/profile/:key - mismo cauce que updateProfileField usa el comando
// /perfil de Telegram; aqui solo se expone por HTTP para el panel.
router.patch('/:key', async (req: Request, res: Response) => {
  const value = sanitizeString(req.body?.value ?? '', 200);
  if (!value) { res.status(400).json({ error: 'El valor no puede estar vacio' }); return; }
  const result = await updateProfileField(String(req.params.key), value, 'manual');
  if (!result.ok) {
    const msg = result.reason === 'unknown_field'    ? 'Campo no reconocido'
              : result.reason === 'immutable_field'  ? `Este campo ya está fijado ("${result.prev}") y no se puede cambiar`
              : 'Valor invalido para ese campo';
    res.status(400).json({ error: msg });
    return;
  }
  res.json(result);
});

export default router;
