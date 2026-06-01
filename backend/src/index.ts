import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import agentRoutes from './routes/agent';
import { startTelegramBot } from './tools/telegram';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'AI Personal OS arrancado' 
  });
});

app.use('/api/agent', agentRoutes); 

mongoose.connect(process.env.MONGODB_URI!)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch((err) => console.error('❌ Error MongoDB:', err));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  startTelegramBot();
});