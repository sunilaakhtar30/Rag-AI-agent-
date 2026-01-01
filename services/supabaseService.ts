
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class SupabaseService {
  private client: SupabaseClient | null = null;

  init(url: string, key: string) {
    this.client = createClient(url, key);
  }

  async storeDocument(id: string, name: string, content: string) {
    if (!this.client) throw new Error("Supabase not initialized");

    const { error } = await this.client
      .from('documents')
      .insert([
        { 
          id, 
          name, 
          content, 
          metadata: { uploaded_at: new Date().toISOString() },
          // In a real implementation with text-embedding-004, you would insert the 1536-dim array here
          embedding: Array(1536).fill(0) 
        }
      ]);

    if (error) {
      console.error("Supabase error code:", error.code);
      throw error;
    }
  }

  async searchKnowledgeBase(query: string): Promise<string> {
    if (!this.client) throw new Error("Supabase not initialized");

    // Standard retrieval: try to find the documents table.
    // In production, we'd use a vector similarity RPC call like 'match_documents'
    const { data, error } = await this.client
      .from('documents')
      .select('content')
      .limit(10);

    if (error) {
      console.error("Supabase search error:", error);
      throw error;
    }
    
    return data?.map(d => d.content).join("\n\n") || "";
  }

  async getDocuments() {
    if (!this.client) return [];
    const { data, error } = await this.client.from('documents').select('id, name, content, status');
    if (error) return [];
    return data || [];
  }
}

export const supabase = new SupabaseService();
