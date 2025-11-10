#!/usr/bin/env node

/**
 * FHIR Clinical Note Ingestion Pipeline (Robust Cleaning)
 *
 * This script processes FHIR JSON files, extracts and cleans clinical text,
 * chunks the text, generates embeddings, and inserts the data directly
 * into a Supabase database for a RAG system.
 */

const fs = require('fs').promises; // Use async fs
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { load } = require('cheerio'); // ⭐️ ADDED: For robust HTML stripping
require('dotenv').config({ path: '.env.local' });


// --- Configuration ---
const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');

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
 * ⭐️ UPDATED ROBUST FUNCTION: Validates and cleans extracted text.
 * Removes templates, AI preambles, HTML, markdown, and empty fields.
 */
function cleanAndValidateText(text) {
  if (!text || text.trim().length < 20) {
    return null; // Skip if text is too short
  }

  // 1. Use Cheerio to parse HTML and get only the text
  const $ = load(text);
  let cleanText = $('body').text();

  // 2. Check for *pure* template markers (to discard the whole note)
  const templateMarkers = [
    "[list any specific symptoms",
    "Please provide details about:", // Catches notes that are just AI questions
    "Okay, here is a medical note template for a patient", // Catches pure template notes
    "The patient presents today for an encounter related to a problem for" // Catches pure AI-generated notes
  ];
  
  // Discard the entire note if it's clearly just a template
  if (templateMarkers.some(marker => cleanText.includes(marker))) {
    return null;
  }
  
  // 3. Clean Template Artifacts (Aggressive Regex)
  
  // Removes AI preambles
  cleanText = cleanText.replace(/^(Okay, here is|Certainly![\s\S]*?Below is) a medical note[\s\S]*/gim, ' ');
  
  // Removes AI commentary
  cleanText = cleanText.replace(/This is unusual phrasing,[\s\S]*/gi, ' ');
  cleanText = cleanText.replace(/Regarding Symptoms Caused by[\s\S]*/gi, ' ');
  cleanText = cleanText.replace(/\(Note: Specific symptom details are pending[\s\S]*?\)/gi, ' '); // Catches "(Note: ...)"
  
  // Removes Disclaimers
  cleanText = cleanText.replace(/Disclaimer: This note is a template[\s\S]*/gi, ' ');
  cleanText = cleanText.replace(/Disclaimer: This medical note is for informational purposes[\s\S]*/gi, ' ');

  // Removes bracketed placeholders like [Insert Date] or [Your Name]
  cleanText = cleanText.replace(/\[[^\]]+\]/g, ' ');

  // Removes instructional text like (If known...)
  cleanText = cleanText.replace(/\(If known, e\.g\., "[^"]+"\)/g, ' ');
  cleanText = cleanText.replace(/\(Document any relevant history, e\.g\., [^)]+\)/g, ' ');
  cleanText = cleanText.replace(/\(Example: [^)]+\)/gi, ' '); // Catches (Example: ...)
  
  // Removes the "Note: This medical note is a template..." footer
  cleanText = cleanText.replace(/Note: This medical note is a template and should be adjusted[\s\S]*/g, ' ');
  
  // Removes markdown artifacts
  cleanText = cleanText.replace(/(\*\*|__|\*|_|---|===|###)/g, ' ');

  // Removes specific "empty" template fields from your files
  cleanText = cleanText.replace(/([A-Z][\w\s\(\)]+):\s*\./gim, ' '); // Catches "Constitutional: ."
  cleanText = cleanText.replace(/([A-Z][\w\s\(\)]+):\s*Vital Signs: \./gim, ' '); // Catches "Vital Signs: ."
  
  // This targets specific junk phrases seen in your files
  cleanText = cleanText.replace(/Reason for Visit: General examination of patient for \./gim, ' ');
  cleanText = cleanText.replace(/Chief Complaint: General examination for \./gim, ' ');
  cleanText = cleanText.replace(/Reason for Encounter: General examination of patient for \./gim, ' ');
  cleanText = cleanText.replace(/He reports , which may be caused by \./gim, ' ');
  cleanText = cleanText.replace(/Symptoms reported \(if any\) may be related to \./gim, ' ');
  cleanText = cleanText.replace(/Plan: - Advised on \./gim, ' ');
  cleanText = cleanText.replace(/The patient reports \./gim, ' ');
  cleanText = cleanText.replace(/Patient reports: \./gim, ' ');
  cleanText = cleanText.replace(/The patient reports experiencing for \./gim, ' ');
  
  // Removes generic "no symptoms" text that adds no value
  cleanText = cleanText.replace(/The patient reports no specific complaints at this time\./gim, ' ');
  cleanText = cleanText.replace(/No specific complaints reported at this time\./gim, ' ');
  cleanText = cleanText.replace(/No specific acute complaints reported at this time\./gim, ' ');
  cleanText = cleanText.replace(/No acute complaints were reported\./gim, ' ');
  cleanText = cleanText.replace(/No acute symptoms were reported\./gim, ' ');
  cleanText = cleanText.replace(/No new symptoms or concerns\./gim, ' ');
  cleanText = cleanText.replace(/He denies any acute distress or significant changes in health status\./gim, ' ');

  // 4. Normalize whitespace (run this *last*)
  cleanText = cleanText.replace(/\s\s+/g, ' ').trim();

  // 5. Final validation after cleaning
  if (cleanText.length < 50) { // Check length *after* cleaning
    return null; // Skip if cleaning removed everything
  }

  return cleanText;
}

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
 * Now includes 'Observation' resources.
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
        note_id: resource.id || 'unknown-id',
        patient_id: patientId,
        source_file: fileName,
        note_date: 'unknown-date',
        note_type: 'Unknown',
        provider: 'Unknown'
      };

      // 1. Extract from DocumentReference
      if (resource.resourceType === 'DocumentReference') {
        noteMetadata.note_date = resource.date;
        noteMetadata.note_type = resource.type?.text || 'DocumentReference';
        noteMetadata.provider = resource.author?.[0]?.display || 'Unknown';
        
        const attachment = resource.content?.[0]?.attachment;
        if (attachment?.data) {
          // Decode Base64 text
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

      // 3. Extract from Observation
      else if (resource.resourceType === 'Observation') {
        if (resource.note && resource.note.length > 0) {
          text = resource.note.map(n => n.text).join('\n');
          
          noteMetadata.note_date = resource.effectiveDateTime || resource.issued;
          noteMetadata.note_type = resource.code?.text || 'Observation Note';
          noteMetadata.provider = resource.performer?.[0]?.display || 'Unknown';
        }
      }
      
      // 4. Clean and Validate
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
 * Main file processing logic.
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
 * Main execution function.
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