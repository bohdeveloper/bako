// Verifica los arreglos de /code-review sobre B1, sin dejar rastro en Mongo.
import 'dotenv/config';
import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import { Person } from '../memory/Person';
import { KnowledgeEntry } from '../memory/KnowledgeEntry';
import { learnFromConversation, consultarCerebro } from '../tools/brain';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  await Person.deleteMany({ nombre: /Mikeltxotest/i });

  console.log('=== 1) Turno normal: debe clasificar bien por la nube ===');
  await learnFromConversation(
    'He conocido a Mikeltxotest, un amigo de Julen que vive en Hernani y es profesor',
    'Encantado de saberlo, señor.'
  );
  const p = await Person.findOne({ nombre: /Mikeltxotest/i });
  console.log(p ? `  OK -> ${p.nombre} | ${p.ubicacion} | ${p.trabajo} | ${JSON.stringify(p.conexiones)}` : '  no creada');

  console.log('\n=== 2) Ficha DESACTIVADA: debe avisar de que no se usará ===');
  if (p) { p.activo = false; await p.save(); }
  await learnFromConversation(
    'Mikeltxotest se ha mudado a Tolosa',
    'Tomo nota, señor.'
  );
  const p2 = await Person.findOne({ nombre: /Mikeltxotest/i });
  console.log(`  ubicacion ahora: ${p2?.ubicacion} | activo: ${p2?.activo}`);
  console.log(`  ¿la ve consultarCerebro? -> ${(await consultarCerebro('Mikeltxotest')).slice(0, 60)}`);

  console.log('\n=== 3) Turno sensible: nunca debe salir a la nube ===');
  await learnFromConversation('Mi nómina de Inetum ha subido', 'Entendido, señor.');

  await Person.deleteMany({ nombre: /Mikeltxotest/i });
  await KnowledgeEntry.deleteMany({ origen: /Mikeltxotest|nómina de Inetum/ });
  console.log('\n(limpiado)');
  await mongoose.disconnect();
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
