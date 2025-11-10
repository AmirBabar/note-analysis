#!/usr/bin/env node

/**
 * FHIR Clinical Note Ingestion Pipeline
 *
 * This script processes FHIR JSON files, extracts and cleans clinical text,
 * chunks the text, generates embeddings, and inserts the data directly
 * into a Supabase database for a RAG system.
 */

const fs = require('fs').promises; // Use async fs
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

// --- Configuration ---
const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');
// 💡 We no longer need NOTE_TEXT_DIR
// const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

// Supabase and Google AI clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Chunking configuration
const CHUNK_SIZE = 1000; // in characters
const CHUNK_OVERLAP = 200; // in characters

// --- Helper Functions ---

/**
 * ⭐️ NEW: Validates and cleans extracted text.
 * Removes templates and HTML.
 */
function cleanAndValidateText(text) {
  if (!text || text.trim().length < 100) {
    return null; // Skip if text is too short
  }

  // 1. Check for template placeholders (add more as you find them)
  const templateMarkers = [
    "[list any specific symptoms",
    "[Insert Date]",
    "This medical note is a template",
    "Patient presents for a general examination",
    "e...."
  ];
  if (templateMarkers.some(marker => text.includes(marker))) {
    return null; // This is a template, skip it
  }

  // 2. Simple HTML stripper (replace with a library for production)
  let cleanText = text.replace(/<[^>]+>/g, ' ');

  // 3. Normalize whitespace
  cleanText = cleanText.replace(/\s\s+/g, ' ').trim();

  return cleanText;
}

/**
 * ⭐️ NEW: Chunks text into overlapping pieces.
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
 * ⭐️ NEW: Generates an embedding for a text chunk.
 */
async function getEmbedding(text) {
  try {
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT", // We are storing this for later retrieval
    });
    return result.embedding.values;
  } catch (error) {
    console.error(`Error generating embedding: ${error.message}`);
    // Handle API rate limits, etc.
    if (error.message.includes('429')) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s and retry
      return getEmbedding(text);
    }
    return null;
  }
}

/**
 * ⭐️ UPDATED: Extracts text from FHIR and returns structured data.
 */
function extractNotesDataFromFHIR(bundle, fileName) {
  const notesData = [];
  if (!bundle.entry) return notesData;

  // First, find the Patient resource to get the ID
  const patientResource = bundle.entry.find(
    e => e.resource.resourceType === 'Patient'
  )?.resource;

  if (!patientResource) return notesData; // No patient, can't process
  const patientId = patientResource.id;

  bundle.entry.forEach((entry) => {
    const resource = entry.resource;

    try {
      let text = null;
      let noteMetadata = {
        note_id: resource.id,
        patient_id: patientId,
        source_file: fileName,
        note_date: null,
        note_type: 'Unknown',
        provider: 'Unknown'
      };

      // 1. Extract from DocumentReference
      if (resource.resourceType === 'DocumentReference') {
        noteMetadata.note_date = resource.date;
        noteMetadata.note_type = resource.type?.text || 'DocumentReference';
        noteMetadata.provider = resource.author?.[0]?.display || 'Unknown';

        const attachment = resource.content?.[0]?.attachment;
        if (attachment?.contentType === 'text/plain' && attachment?.data) {
          // Decode Base64 text
          text = Buffer.from(attachment.data, 'base64').toString('utf-8');
        } else if (attachment?.contentType.includes('html') && attachment?.data) {
          text = Buffer.from(attachment.data, 'base64').toString('utf-8');
        }
      }

      // 2. Extract from DiagnosticReport
      else if (resource.resourceType === 'DiagnosticReport') {
        noteMetadata.note_date = resource.effectiveDateTime || resource.issued;
        noteMetadata.note_type = resource.code?.text || 'DiagnosticReport';
        noteMetadata.provider = resource.performer?.[0]?.display || 'Unknown';

        if (resource.text?.div) {
          text = resource.text.div; // This is HTML
        }
      }

      // 3. Clean and Validate
      const cleanText = cleanAndValidateText(text);

      if (cleanText) {
        notesData.push({
          cleanText,
          metadata: noteMetadata
        });
      }

    } catch (error) {
      console.warn(`Skipping resource in ${fileName} due to error: ${error.message}`);
    }
  });

  return notesData;
}

/**
 * ⭐️ UPDATED: Main file processing logic.
 */
async function processFHIRFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\nProcessing: ${fileName}`);

  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const bundle = JSON.parse(fileContent);

    // 1. Extract all clean notes and their metadata
    const notesToProcess = extractNotesDataFromFHIR(bundle, fileName);
    if (notesToProcess.length === 0) {
      console.log(`  - No valid, non-template notes found.`);
      return { fileName, chunksInserted: 0 };
    }

    console.log(`  - Extracted ${notesToProcess.length} valid notes.`);

    let totalChunksInserted = 0;

    // 2. Process each note (chunk, embed, insert)
    for (const note of notesToProcess) {
      const chunks = chunkText(note.cleanText);
      const insertions = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];

        // 3. Get embedding
        const embedding = await getEmbedding(chunkContent);
        if (!embedding) continue; // Skip if embedding failed

        insertions.push({
          patient_id: note.metadata.patient_id,
          note_id: note.metadata.note_id,
          chunk_index: i,
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

      // 4. Batch insert chunks into Supabase
      if (insertions.length > 0) {
        const { error } = await supabase
          .from('clinical_notes_embeddings')
          .insert(insertions);

        if (error) {
          console.error(`    - DB Error for note ${note.metadata.note_id}: ${error.message}`);
          if (error.code === '23505') { // unique_note_chunk constraint
             console.warn(`    - Note chunks already exist, skipping.`);
          }
        } else {
          totalChunksInserted += insertions.length;
        }
      }
    }

    console.log(`  - Successfully inserted ${totalChunksInserted} chunks.`);
    return { fileName, chunksInserted: totalChunksInserted };

  } catch (error) {
    console.error(`  - 💥 FAILED to process ${fileName}: ${error.message}`);
    return { fileName, chunksInserted: 0, error: error.message };
  }
}

/**
 * ⭐️ UPDATED: Main execution function.
 */
async function main() {
  console.log('🚀 Starting FHIR Ingestion Pipeline...');

  try {
    const files = await fs.readdir(FHIR_DATA_DIR);
    const fhirFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(FHIR_DATA_DIR, f));

    if (fhirFiles.length === 0) {
      console.warn(`No FHIR .json files found in ${FHIR_DATA_DIR}`);
      return;
    }

    console.log(`📋 Found ${fhirFiles.length} FHIR files to process.`);

    let totalChunks = 0;
    let successfulFiles = 0;
    const errors = [];

    // Process all files
    for (const filePath of fhirFiles) {
      const result = await processFHIRFile(filePath);
      if (result.chunksInserted > 0) {
        successfulFiles++;
        totalChunks += result.chunksInserted;
      }
      if (result.error) {
        errors.push(`${result.fileName}: ${result.error}`);
      }
    }

    // Summary
    console.log('\n📊 INGESTION SUMMARY');
    console.log('=====================');
    console.log(`✅ Files processed: ${fhirFiles.length}`);
    console.log(`✅ Files with data ingested: ${successfulFiles}`);
    console.log(`📝 Total chunks ingested: ${totalChunks}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Errors encountered:`);
      errors.forEach(error => console.log(`   - ${error}`));
    }
    console.log('\n🎉 Ingestion complete!');

  } catch (error) {
    console.error('\n💥 Fatal error during processing:', error);
    process.exit(1);
  }
}

main();