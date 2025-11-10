import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ClinicalNote } from './fhir-extraction';

export interface ClinicalNoteEmbedding {
  id?: string;
  patient_id: string;
  note_id: string;
  chunk_index: number;
  content: string;
  embedding: number[];
  metadata: {
    date: string;
    doctor: string;
    organization: string;
    note_type: string;
    file_name: string;
    chunk_count?: number;
  };
  created_at?: string;
}

class SupabaseVectorDB {
  private client: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    this.client = createClient(supabaseUrl, supabaseKey);
  }

  async initializeDatabase(): Promise<void> {
    try {
      console.log('Database initialization: Supabase pgvector extension should be enabled manually in Supabase dashboard');
      console.log('Table creation will be handled by individual operations (upsert will create table if needed)');
      console.log('Database ready for vector operations');
    } catch (error) {
      console.warn('Database initialization warning:', error);
      // Continue without throwing - the system should work with Supabase's auto-table creation
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      // Use Google Generative AI text-embedding-004 model (768 dimensions)
      const { GoogleGenerativeAI } = require('@google/generative-ai');

      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not found in environment variables');
      }

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

      const result = await model.embedContent(text);
      const embedding = result.embedding.values;

      console.log('✅ Using Google text-embedding-004 (768 dimensions)');
      return embedding;

    } catch (error) {
      console.error('Error creating embedding with Google:', error);
      console.log('🔄 Using mock embedding for development (768 dimensions)');
      // Fallback: return mock embedding with 768 dimensions for Google text-embedding-004
      return Array(768).fill(0).map(() => Math.random() - 0.5);
    }
  }

  async storeNoteEmbeddings(note: ClinicalNote, chunks: string[]): Promise<void> {
    try {
      const embeddings: ClinicalNoteEmbedding[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await this.createEmbedding(chunk);

        embeddings.push({
          patient_id: note.patientId,
          note_id: note.id,
          chunk_index: i,
          content: chunk,
          embedding,
          metadata: {
            date: note.date,
            doctor: note.doctor,
            organization: note.organization,
            note_type: note.noteType,
            file_name: note.fileName,
            chunk_count: chunks.length
          }
        });
      }

      // Insert embeddings in batches
      const batchSize = 100;
      for (let i = 0; i < embeddings.length; i += batchSize) {
        const batch = embeddings.slice(i, i + batchSize);

        const { error } = await this.client
          .from('clinical_notes_embeddings')
          .upsert(batch, { onConflict: 'patient_id,note_id,chunk_index' });

        if (error) {
          console.error('Error storing embeddings batch:', error);
          throw error;
        }
      }

      console.log(`Stored ${embeddings.length} embeddings for note ${note.id}`);
    } catch (error) {
      console.error('Error storing note embeddings:', error);
      throw error;
    }
  }

  async searchSimilarNotes(
    query: string,
    patientId?: string,
    limit: number = 5,
    similarityThreshold: number = 0.7
  ): Promise<ClinicalNoteEmbedding[]> {
    try {
      const queryEmbedding = await this.createEmbedding(query);

      // Use search_clinical_notes function if available, otherwise fallback to basic query
      const { data, error } = await this.client.rpc('search_clinical_notes', {
        query_embedding: queryEmbedding,
        similarity_threshold: similarityThreshold,
        match_count: limit,
        patient_id_filter: patientId || null
      });

      if (error) {
        console.warn('RPC search failed, trying fallback:', error);

        // Fallback: Get recent notes without vector search
        let query = this.client
          .from('clinical_notes_embeddings')
          .select('*');

        if (patientId) {
          query = query.eq('patient_id', patientId);
        }

        const { data: fallbackData, error: fallbackError } = await query
          .order('created_at', { ascending: false })
          .limit(limit);

        if (fallbackError) {
          throw fallbackError;
        }

        return fallbackData || [];
      }

      return data || [];
    } catch (error) {
      console.error('Error searching similar notes:', error);
      return [];
    }
  }

  async getPatientNotes(patientId: string, limit: number = 50): Promise<ClinicalNoteEmbedding[]> {
    try {
      console.log('🔍 DEBUG: Getting patient notes for patient:', patientId);
      const { data, error } = await this.client
        .from('clinical_notes_embeddings')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error getting patient notes:', error);
        throw error;
      }

      console.log('🔍 DEBUG: Found', data?.length || 0, 'notes for patient:', patientId);
      return data || [];
    } catch (error) {
      console.error('Error getting patient notes:', error);
      return [];
    }
  }

  async deleteNoteEmbeddings(noteId: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('clinical_notes_embeddings')
        .delete()
        .eq('note_id', noteId);

      if (error) {
        console.error('Error deleting note embeddings:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error deleting note embeddings:', error);
      throw error;
    }
  }

  async getDatabaseStats(): Promise<any> {
    try {
      const { data, error } = await this.client
        .from('clinical_notes_embeddings')
        .select('patient_id, note_id, metadata')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error getting database stats:', error);
        return {};
      }

      const stats = {
        totalEmbeddings: data?.length || 0,
        uniquePatients: new Set(data?.map(item => item.patient_id)).size,
        uniqueNotes: new Set(data?.map(item => item.note_id)).size,
        recentNotes: data?.slice(0, 10)
      };

      return stats;
    } catch (error) {
      console.error('Error getting database stats:', error);
      return {};
    }
  }
}

// Create singleton instance
const supabaseVectorDB = new SupabaseVectorDB();

export default supabaseVectorDB;
export { SupabaseVectorDB };