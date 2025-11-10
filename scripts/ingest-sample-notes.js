#!/usr/bin/env node

/**
 * Sample Clinical Notes Ingestion Script
 *
 * This script processes sample clinical notes, generates embeddings,
 * and inserts them into the Supabase database for testing the RAG system.
 */

const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

// --- Configuration ---
const SAMPLE_NOTES_FILE = path.join(__dirname, '../sample-clinical-notes.json');

// Supabase and Google AI clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Chunking configuration
const CHUNK_SIZE = 800; // in characters
const CHUNK_OVERLAP = 150; // in characters

// --- Helper Functions ---

/**
 * Chunks text into overlapping pieces.
 */
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    const end = Math.min(i + size, text.length);
    chunks.push(text.substring(start, end));
    i += size - overlap;
    if (i + overlap >= text.length) {
      break; // Stop if the next chunk would be mostly overlap
    }
  }
  return chunks;
}

/**
 * Generates an embedding for a text chunk.
 */
async function getEmbedding(text) {
  try {
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
    });
    return result.embedding.values;
  } catch (error) {
    console.error(`Error generating embedding: ${error.message}`);
    // Handle API rate limits
    if (error.message.includes('429')) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s and retry
      return getEmbedding(text);
    }
    return null;
  }
}

/**
 * Processes sample clinical notes and inserts into database
 */
async function ingestSampleNotes() {
  console.log('🚀 Starting Sample Clinical Notes Ingestion...');

  try {
    // Read sample notes
    const notesContent = await fs.readFile(SAMPLE_NOTES_FILE, 'utf-8');
    const notes = JSON.parse(notesContent);

    console.log(`📋 Found ${notes.length} sample clinical notes to process.`);

    let totalChunksInserted = 0;
    let successfulNotes = 0;

    // Process each note
    for (const note of notes) {
      console.log(`\nProcessing note: ${note.note_id} (${note.note_type})`);

      const chunks = chunkText(note.content);
      const insertions = [];

      console.log(`  - Created ${chunks.length} text chunks`);

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];

        // Generate embedding
        const embedding = await getEmbedding(chunkContent);
        if (!embedding) {
          console.warn(`    - Skipping chunk ${i} due to embedding failure`);
          continue;
        }

        insertions.push({
          patient_id: note.patient_id,
          note_id: note.note_id,
          chunk_index: i,
          content: chunkContent,
          embedding: embedding,
          metadata: {
            note_date: note.note_date,
            note_type: note.note_type,
            provider: note.provider,
            source_file: 'sample-clinical-notes.json',
            original_note_length: note.content.length
          }
        });
      }

      // Insert chunks into Supabase
      if (insertions.length > 0) {
        const { error } = await supabase
          .from('clinical_notes_embeddings')
          .upsert(insertions, {
            onConflict: 'note_id,chunk_index',
            ignoreDuplicates: false
          });

        if (error) {
          console.error(`    - DB Error for note ${note.note_id}: ${error.message}`);
          if (error.code === '23505') {
            console.warn(`    - Note chunks already exist, skipping.`);
          }
        } else {
          totalChunksInserted += insertions.length;
          successfulNotes++;
          console.log(`    - ✅ Successfully inserted ${insertions.length} chunks`);
        }
      }
    }

    // Summary
    console.log('\n📊 INGESTION SUMMARY');
    console.log('=====================');
    console.log(`✅ Notes processed: ${notes.length}`);
    console.log(`✅ Notes successfully inserted: ${successfulNotes}`);
    console.log(`📝 Total chunks inserted: ${totalChunksInserted}`);

    // Verify insertion by getting database stats
    console.log('\n🔍 VERIFYING DATABASE CONTENTS...');
    const { data: verificationData, error: verificationError } = await supabase
      .from('clinical_notes_embeddings')
      .select('patient_id, note_id, metadata')
      .order('created_at', { ascending: false })
      .limit(10);

    if (verificationError) {
      console.error('❌ Error verifying insertion:', verificationError);
    } else {
      console.log('✅ Database verification successful. Recent entries:');
      verificationData.forEach((item, index) => {
        console.log(`   ${index + 1}. Patient: ${item.patient_id}, Note: ${item.note_id}, Type: ${item.metadata?.note_type || 'Unknown'}`);
      });
    }

    console.log('\n🎉 Sample notes ingestion complete!');

  } catch (error) {
    console.error('\n💥 Fatal error during ingestion:', error);
    process.exit(1);
  }
}

ingestSampleNotes();