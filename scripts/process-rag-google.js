#!/usr/bin/env node

/**
 * RAG Database Processing with Google Embeddings
 *
 * This script processes clinical notes using Google's text-embedding-004 model
 * with chunking and batching for optimal performance.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Configuration
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');
const CHUNK_SIZE = 2000; // Characters per chunk
const BATCH_SIZE = 100; // Max requests per batch (Google API limit)
const EMBEDDING_DIMENSIONS = 768; // Google text-embedding-004 dimensions

// Initialize Google Generative AI
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  console.error('❌ GEMINI_API_KEY not found in environment variables');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Chunk text into smaller pieces for embedding
 * @param {string} text - The text to chunk
 * @param {number} chunkSize - Target chunk size in characters
 * @returns {string[]} - Array of text chunks
 */
function chunkText(text, chunkSize = CHUNK_SIZE) {
  const chunks = [];

  // Simple character-based chunking - in production you'd use a more sophisticated approach
  for (let i = 0; i < text.length; i += chunkSize) {
    let chunk = text.substring(i, i + chunkSize);

    // Try to break at word boundaries to avoid cutting words
    if (i + chunkSize < text.length) {
      const lastSpace = chunk.lastIndexOf(' ');
      const lastNewline = chunk.lastIndexOf('\n');
      const lastBreak = Math.max(lastSpace, lastNewline);

      if (lastBreak > chunkSize * 0.8) { // Only break if we have at least 80% of the chunk
        chunk = chunk.substring(0, lastBreak);
      }
    }

    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }
  }

  return chunks.length > 0 ? chunks : [text]; // Ensure at least one chunk
}

/**
 * Parse note text file and extract individual notes
 */
function parseNoteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const notes = [];

  // Extract note information using regex patterns
  const noteMatches = content.matchAll(/NOTE (\d+): (.*?)\n-{40}\nNote ID: (.*?)\nPatient ID: (.*?)\nDate: (.*?)\nProvider: (.*?)\nOrganization: (.*?)\nContent Length: (\d+) characters\n\nCLINICAL CONTENT:\n(.*?)(?=\n={50}\n\nNOTE \d+|\n={50}\n\n$)/gs);

  for (const match of noteMatches) {
    const [, noteNumber, noteType, noteId, patientId, date, provider, organization, contentLength, clinicalContent] = match;

    notes.push({
      noteNumber: parseInt(noteNumber),
      noteType: noteType.trim(),
      noteId: noteId.trim(),
      patientId: patientId.trim(),
      date: date.trim(),
      provider: provider.trim(),
      organization: organization.trim(),
      contentLength: parseInt(contentLength),
      clinicalContent: clinicalContent.trim(),
      sourceFile: path.basename(filePath)
    });
  }

  return notes;
}

/**
 * Create embeddings using Google's text-embedding-004 model with batching
 * @param {string[]} textChunks - Array of text chunks to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function createEmbeddingsBatch(textChunks) {
  try {
    console.log(`🔄 Creating embeddings for ${textChunks.length} chunks...`);

    // Prepare batch requests (max 100 per batch)
    const allEmbeddings = [];

    for (let i = 0; i < textChunks.length; i += BATCH_SIZE) {
      const batchChunks = textChunks.slice(i, Math.min(i + BATCH_SIZE, textChunks.length));
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(textChunks.length / BATCH_SIZE);

      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batchChunks.length} chunks)`);

      const requests = batchChunks.map(chunk => ({
        content: { parts: [{ text: chunk }] },
        taskType: "RETRIEVAL_DOCUMENT" // Optimize for document retrieval
      }));

      const result = await model.batchEmbedContents({ requests });
      const batchEmbeddings = result.embeddings.map(embedding => embedding.values);

      allEmbeddings.push(...batchEmbeddings);

      // Add small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Successfully created ${allEmbeddings.length} embeddings (${EMBEDDING_DIMENSIONS} dimensions each)`);
    return allEmbeddings;

  } catch (error) {
    console.error('❌ Error creating embeddings batch:', error);
    throw error;
  }
}

/**
 * Store note chunks with embeddings in database
 */
async function storeNoteChunks(note, chunks, embeddings) {
  try {
    const records = chunks.map((chunk, index) => ({
      note_id: `${note.noteId}_chunk_${index}`,
      patient_id: note.patientId,
      chunk_index: index,
      content: chunk,
      embedding: embeddings[index],
      metadata: {
        note_type: note.noteType,
        note_date: note.date,
        provider: note.provider,
        organization: note.organization,
        source_file: note.sourceFile,
        total_chunks: chunks.length,
        parent_note_id: note.noteId
      },
      created_at: new Date().toISOString()
    }));

    // Insert all chunks for this note
    const { data, error } = await supabase
      .from('clinical_notes_embeddings')
      .upsert(records, {
        onConflict: 'note_id,chunk_index'
      });

    if (error) {
      console.error(`❌ Error storing chunks for note ${note.noteId}:`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`❌ Error storing note ${note.noteId}:`, error);
    return false;
  }
}

/**
 * Process a single note file
 */
async function processNoteFile(filePath, maxNotes = 3) {
  const fileName = path.basename(filePath);
  console.log(`🔄 Processing: ${fileName}`);

  try {
    const notes = parseNoteFile(filePath);

    if (notes.length === 0) {
      console.log(`ℹ️ No notes found in ${fileName}`);
      return { fileName, notesProcessed: 0, chunksStored: 0, success: true };
    }

    console.log(`📝 Found ${notes.length} notes in ${fileName} (processing all notes)`);

    // Process all notes for complete database population
    const allNotes = notes;
    let totalChunksStored = 0;

    for (const note of allNotes) {
      console.log(`📄 Processing note ${note.noteId} (${note.noteType})`);

      // 1. Chunk the clinical content
      const chunks = chunkText(note.clinicalContent, CHUNK_SIZE);
      console.log(`  🔀 Split into ${chunks.length} chunks (${CHUNK_SIZE} chars each)`);

      // 2. Create embeddings for all chunks
      const embeddings = await createEmbeddingsBatch(chunks);

      // 3. Store chunks with embeddings in database
      const stored = await storeNoteChunks(note, chunks, embeddings);
      if (stored) {
        totalChunksStored += chunks.length;
        console.log(`  ✅ Stored ${chunks.length} chunks for note ${note.noteId}`);
      } else {
        console.log(`  ❌ Failed to store note ${note.noteId}`);
      }
    }

    console.log(`✅ Completed ${fileName}: ${totalChunksStored} chunks from ${testNotes.length} notes stored`);
    return { fileName, notesProcessed: testNotes.length, chunksStored: totalChunksStored, success: true };

  } catch (error) {
    console.error(`❌ Error processing ${fileName}:`, error.message);
    return { fileName, notesProcessed: 0, chunksStored: 0, success: false, error: error.message };
  }
}

/**
 * Main processing function
 */
async function main() {
  console.log('🚀 RAG Database Processing with Google Embeddings');
  console.log('===================================================');
  console.log(`📂 Note Text Directory: ${NOTE_TEXT_DIR}`);
  console.log(`🧠 Model: Google text-embedding-004`);
  console.log(`📏 Embedding Dimensions: ${EMBEDDING_DIMENSIONS}`);
  console.log(`🔀 Chunk Size: ${CHUNK_SIZE} characters`);
  console.log(`📦 Batch Size: ${BATCH_SIZE} requests`);
  console.log('');

  try {
    // Check if note_text directory exists
    if (!fs.existsSync(NOTE_TEXT_DIR)) {
      console.error('❌ note_text directory not found');
      process.exit(1);
    }

    // Get all note text files
    const files = fs.readdirSync(NOTE_TEXT_DIR).filter(file => file.endsWith('_extracted_notes.txt'));

    if (files.length === 0) {
      console.log('ℹ️ No note text files found to process');
      return;
    }

    console.log(`📋 Found ${files.length} note text files to process`);
    console.log('');

    // Process files
    const results = [];
    let totalChunksStored = 0;

    // Process all files to populate the entire database
  for (const fileName of files) {
    console.log(`\n🔄 Processing file ${files.indexOf(fileName) + 1}/${files.length}: ${fileName}`);
    const result = await processNoteFile(path.join(NOTE_TEXT_DIR, fileName));
    results.push(result);

    if (result.success) {
      totalChunksStored += result.chunksStored;
      totalNotesProcessed += result.notesProcessed;
      console.log(`📊 Running total: ${totalChunksStored} chunks from ${totalNotesProcessed} notes`);
    }

    // Small delay between files to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

    // Summary
    console.log('');
    console.log('📊 PROCESSING SUMMARY');
    console.log('====================');

    const successfulFiles = results.filter(r => r.success).length;
    const failedFiles = results.filter(r => !r.success).length;

    console.log(`✅ Files processed: ${successfulFiles}/${results.length}`);
    if (failedFiles > 0) {
      console.log(`❌ Files failed: ${failedFiles}`);
    }
    console.log(`📝 Total notes processed: ${results.reduce((sum, r) => sum + (r.notesProcessed || 0), 0)}`);
    console.log(`🧩 Total chunks stored: ${totalChunksStored}`);
    console.log(`🗄️ Database: Supabase with pgvector`);

    if (successfulFiles === results.length) {
      console.log('🎉 All files processed successfully!');
      console.log('');
      console.log('🔍 Ready for RAG queries with vector similarity search!');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);