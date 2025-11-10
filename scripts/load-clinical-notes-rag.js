#!/usr/bin/env node

/**
 * Load Clinical Notes into RAG Database
 *
 * This script processes the extracted clinical notes from note_text,
 * chunks them, generates embeddings, and inserts them into Supabase.
 */

const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

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
      break;
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
    if (error.message.includes('429')) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return getEmbedding(text);
    }
    return null;
  }
}

/**
 * Parse note content from extracted file
 */
function parseNoteContent(content, sourceFile) {
  const notes = [];

  // Split by note sections
  const noteSections = content.split('## Note');

  // Skip header (first section before "## Note")
  for (let i = 1; i < noteSections.length; i++) {
    const section = noteSections[i];

    // Extract metadata
    const lines = section.split('\n');
    let noteText = '';
    let metadata = {
      note_id: `note_${i}`,
      patient_id: 'unknown',
      source_file: sourceFile,
      note_date: null,
      note_type: 'Unknown',
      provider: 'Unknown'
    };

    let inTextSection = false;
    for (const line of lines) {
      if (line.startsWith('**Clinical Content:**')) {
        inTextSection = true;
        continue;
      }
      if (inTextSection && line.startsWith('='.repeat(10))) {
        break;
      }
      if (inTextSection && line.trim()) {
        noteText += line.trim() + ' ';
      }

      // Extract metadata
      if (line.includes('**Note ID:**')) {
        metadata.note_id = line.split('**Note ID:**')[1].trim();
      } else if (line.includes('**Patient ID:**')) {
        metadata.patient_id = line.split('**Patient ID:**')[1].trim();
      } else if (line.includes('**Note Type:**')) {
        metadata.note_type = line.split('**Note Type:**')[1].trim();
      } else if (line.includes('**Provider:**')) {
        metadata.provider = line.split('**Provider:**')[1].trim();
      } else if (line.includes('**Date:**')) {
        metadata.note_date = line.split('**Date:**')[1].trim();
      }
    }

    if (noteText.trim().length > 50) {
      notes.push({
        text: noteText.trim(),
        metadata
      });
    }
  }

  return notes;
}

/**
 * Main loading function
 */
async function main() {
  console.log('🚀 Starting Clinical Notes RAG Loading...');

  try {
    const files = await fs.readdir(NOTE_TEXT_DIR);
    const noteFiles = files.filter(f => f.endsWith('.txt'));

    if (noteFiles.length === 0) {
      console.log('❌ No note files found in note_text directory');
      return;
    }

    console.log(`📋 Found ${noteFiles.length} note files to process.`);

    let totalChunks = 0;
    let totalNotes = 0;

    for (const file of noteFiles) {
      console.log(`\n📁 Processing: ${file}`);

      const filePath = path.join(NOTE_TEXT_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');

      const notes = parseNoteContent(content, file);

      if (notes.length === 0) {
        console.log('  ⚠️ No valid notes found in file');
        continue;
      }

      console.log(`  📊 Found ${notes.length} notes`);

      let fileChunks = 0;

      for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
        const note = notes[noteIndex];

        console.log(`    Processing note ${noteIndex + 1}/${notes.length}...`);

        const chunks = chunkText(note.text);
        const insertions = [];

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunkContent = chunks[chunkIndex];

          const embedding = await getEmbedding(chunkContent);
          if (!embedding) continue;

          insertions.push({
            patient_id: note.metadata.patient_id,
            note_id: note.metadata.note_id,
            chunk_index: chunkIndex,
            content: chunkContent,
            embedding: embedding,
            metadata: {
              note_date: note.metadata.note_date,
              note_type: note.metadata.note_type,
              provider: note.metadata.provider,
              source_file: note.metadata.source_file
            }
          });
        }

        // Insert chunks in batches
        if (insertions.length > 0) {
          const { error } = await supabase
            .from('clinical_notes_embeddings')
            .upsert(insertions, {
              onConflict: 'note_id,chunk_index',
              ignoreDuplicates: false
            });

          if (error) {
            console.error(`    ❌ DB Error: ${error.message}`);
          } else {
            fileChunks += insertions.length;
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      totalChunks += fileChunks;
      totalNotes += notes.length;
      console.log(`  ✅ Inserted ${fileChunks} chunks from ${notes.length} notes`);
    }

    console.log('\n📊 LOADING SUMMARY');
    console.log('===================');
    console.log(`✅ Files processed: ${noteFiles.length}`);
    console.log(`✅ Notes processed: ${totalNotes}`);
    console.log(`📝 Total chunks inserted: ${totalChunks}`);

    // Verify insertion
    const { data: verificationData } = await supabase
      .from('clinical_notes_embeddings')
      .select('patient_id, note_id, metadata')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('\n✅ Recent database entries:');
    verificationData?.forEach((item, index) => {
      console.log(`   ${index + 1}. Patient: ${item.patient_id}, Type: ${item.metadata?.note_type || 'Unknown'}`);
    });

    console.log('\n🎉 RAG loading complete!');

  } catch (error) {
    console.error('\n💥 Fatal error during loading:', error);
    process.exit(1);
  }
}

main();