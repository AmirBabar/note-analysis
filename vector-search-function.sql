-- Vector Search Function for Clinical Notes
-- Run this in your Supabase SQL Editor

CREATE OR REPLACE FUNCTION search_clinical_notes(
  query_embedding vector(768),
  match_count integer DEFAULT 5,
  similarity_threshold float DEFAULT 0.5,
  patient_id_filter text DEFAULT NULL
)
RETURNS TABLE (
  note_id text,
  patient_id text,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cne.note_id,
    cne.patient_id,
    cne.chunk_index,
    cne.content,
    cne.metadata,
    1 - (cne.embedding <=> query_embedding) as similarity
  FROM clinical_notes_embeddings cne
  WHERE 1 - (cne.embedding <=> query_embedding) > similarity_threshold
    AND (patient_id_filter IS NULL OR cne.patient_id = patient_id_filter)
  ORDER BY cne.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;