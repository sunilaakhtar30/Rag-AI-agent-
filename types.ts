
export interface Document {
  id: string;
  name: string;
  content: string;
  status: 'processing' | 'ready' | 'error';
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

export interface VectorDBConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}
