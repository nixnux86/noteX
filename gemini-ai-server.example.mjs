// Minimal noteX AI Ask backend example.
// Usage:
//   npm install express cors @google/genai dotenv
//   GEMINI_API_KEY=your_key_here node gemini-ai-server.example.mjs
// Then in noteX .env:
//   VITE_NOTEX_AI_ENDPOINT=http://localhost:8787/api/ask

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/ask', async (req, res) => {
  try {
    const { question, context = [], workspace = 'noteX workspace' } = req.body || {};
    if (!question) return res.status(400).json({ error: 'Missing question.' });
    const contextText = context.map((item, index) => (
      `Source ${index + 1}: ${item.title}\n${item.text || ''}`
    )).join('\n\n---\n\n').slice(0, 24000);

    const prompt = `You are noteX AI. Answer the user question using only the provided note context when possible.\n\nWorkspace: ${workspace}\nQuestion: ${question}\n\nNote context:\n${contextText}\n\nReturn a clear answer and mention source titles when relevant.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    res.json({
      answer: response.text || 'No answer returned.',
      sources: context.map(item => ({ pageId: item.pageId, title: item.title }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || 'AI request failed.' });
  }
});

app.listen(8787, () => console.log('noteX AI server listening on http://localhost:8787'));
