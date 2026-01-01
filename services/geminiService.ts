
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    if (!API_KEY) {
      throw new Error("API_KEY environment variable is not set");
    }
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
  }

  /**
   * Processes a file's raw content to extract clean text or summarize it.
   */
  async processFileContent(name: string, content: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Extract all meaningful text and key information from this document named "${name}". Keep it clean and concise for a vector knowledge base:\n\n${content}`,
      config: {
        temperature: 0.1,
      }
    });
    return response.text || "";
  }

  /**
   * Generates a "Simulated" embedding using the model's feature extraction capability
   * Note: In a production environment, you would use the 'text-embedding-004' model.
   * Since we want to use the latest Gemini 3 models for reasoning:
   */
  async generateAnswer(question: string, context: string): Promise<{ text: string, sources: string[] }> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [
        {
          text: `You are a helpful AI assistant. Use the following pieces of retrieved context to answer the user's question. If you don't know the answer based on the context, say that you don't know. 

Context:
${context}

Question: ${question}`
        }
      ],
      config: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 1000 }
      }
    });

    return {
      text: response.text || "I'm sorry, I couldn't generate an answer.",
      sources: [] // In a real RAG system, we'd extract these from the context chunks
    };
  }
}

export const gemini = new GeminiService();
