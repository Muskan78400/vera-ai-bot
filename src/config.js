import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  mongoUri: process.env.MONGODB_URI || '',
  llmProvider: process.env.LLM_PROVIDER || 'gemini',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  }
};

export default config;
