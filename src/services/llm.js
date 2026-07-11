import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../config.js';

let geminiClient = null;
let openaiClient = null;

// Initialize clients if API keys are available
if (config.gemini.apiKey) {
  geminiClient = new GoogleGenerativeAI(config.gemini.apiKey);
}
if (config.openai.apiKey) {
  openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
}

/**
 * Executes a chat completion prompt against the selected LLM provider.
 * Uses temperature = 0.0 for deterministic output generation.
 */
export async function completePrompt(systemInstruction, userPrompt) {
  const provider = config.llmProvider.toLowerCase();

  if (provider === 'gemini') {
    if (!geminiClient) {
      throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in your .env file.');
    }

    const modelInstance = geminiClient.getGenerativeModel({
      model: config.gemini.model,
      systemInstruction: systemInstruction,
    });

    const result = await modelInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.0,
      },
    });

    const response = result.response;
    return response.text();
  } else if (provider === 'openai') {
    if (!openaiClient) {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in your .env file.');
    }

    const response = await openaiClient.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0,
    });

    return response.choices[0].message.content;
  } else {
    throw new Error(`Unsupported LLM provider: ${config.llmProvider}`);
  }
}
