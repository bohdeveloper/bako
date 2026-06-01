import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Creamos una sola instancia del cliente — se reutiliza en toda la app
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Esta función es la que llamarán los agentes
// Recibe un prompt (instrucción) y devuelve la respuesta de Claude
export async function askClaude(prompt: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extraemos solo el texto de la respuesta
  const block = response.content[0];
  if (block.type === 'text') {
    return block.text;
  }

  return 'Sin respuesta';
}