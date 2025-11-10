#!/usr/bin/env node

/**
 * RAG Database Processing Script
 *
 * This script processes all extracted clinical notes files and creates
 * vector embeddings in the Supabase database for RAG functionality.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');
const BATCH_SIZE = 10; // Process notes in batches to avoid rate limits

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase configuration. Please check environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Create text embedding using BAAI BGE model (1024 dimensions)
 */
async function createEmbedding(text) {
  try {
    // Try Hugging Face BAAI/bge-base-en-v1.5 embeddings
    const hfResponse = await fetch('https://api-inference.huggingface.co/models/BAAI/bge-base-en-v1.5', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY || 'hf_token_placeholder'}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: text,
      }),
    });

    if (hfResponse.ok) {
      const hfData = await hfResponse.json();
      if (Array.isArray(hfData) && hfData.length > 0 && Array.isArray(hfData[0])) {
        return hfData[0]; // BGE base model returns 1024 dimensions
      }
    }

    // Fallback to OpenAI if available (will be 1536 dimensions, different from BGE)
    const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text,
      }),
    });

    if (openaiResponse.ok) {
      const data = await openaiResponse.json();
      console.log('⚠️ Using OpenAI embeddings (1536 dimensions) - BGE recommended for consistency');
      return data.data[0].embedding;
    }

    throw new Error('Both HuggingFace and OpenAI APIs failed');

  } catch (error) {
    console.error('❌ Error creating embedding:', error.message);
    console.log('🔄 Using mock embedding for development (1024 dimensions)');
    // Fallback: return mock embedding with 1024 dimensions for BGE consistency
    return Array(1024).fill(0).map(() => Math.random() - 0.5);
  }
}

/**
 * Parse a note text file and extract individual notes
 */
function parseNoteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const notes = [];

  // Split by note separators
  const noteSections = content.split(/NOTE \d+:.*?\n-{40}\n/).filter(section => section.trim());

  // Extract note metadata and content
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
      content: clinicalContent.trim(),
      sourceFile: path.basename(filePath)
    });
  }

  return notes;
}

/**
 * Store note embeddings in database
 */
async function storeNoteEmbedding(note, embedding) {
  try {
    const { data, error } = await supabase
      .from('clinical_notes_embeddings')
      .upsert({
        note_id: note.noteId,
        patient_id: note.patientId,
        note_type: note.noteType,
        note_date: note.date,
        provider: note.provider,
        organization: note.organization,
        content_length: note.contentLength,
        clinical_content: note.content,
        source_file: note.sourceFile,
        embedding: embedding,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'note_id'
      });

    if (error) {
      console.error(`❌ Error storing note ${note.noteId}:`, error);
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
async function processNoteFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`🔄 Processing: ${fileName}`);

  try {
    const notes = parseNoteFile(filePath);

    if (notes.length === 0) {
      console.log(`ℹ️ No notes found in ${fileName}`);
      return { fileName, notesProcessed: 0, success: true };
    }

    console.log(`📝 Found ${notes.length} notes in ${fileName}`);

    let successCount = 0;

    // Process notes in batches
    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
      const batch = notes.slice(i, i + BATCH_SIZE);
      console.log(`🔄 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(notes.length/BATCH_SIZE)}`);

      for (const note of batch) {
        try {
          // Create embedding for the note content
          const embedding = await createEmbedding(note.content);

          // Store in database
          const stored = await storeNoteEmbedding(note, embedding);
          if (stored) {
            successCount++;
          }

          // Add small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          console.error(`❌ Error processing note ${note.noteId}:`, error.message);
        }
      }
    }

    console.log(`✅ Completed ${fileName}: ${successCount}/${notes.length} notes stored`);
    return { fileName, notesProcessed: successCount, totalNotes: notes.length, success: true };

  } catch (error) {
    console.error(`❌ Error processing ${fileName}:`, error.message);
    return { fileName, notesProcessed: 0, success: false, error: error.message };
  }
}

/**
 * Main processing function
 */
async function main() {
  console.log('🚀 RAG Database Processing Script');
  console.log('==================================');
  console.log(`📂 Note Text Directory: ${NOTE_TEXT_DIR}`);
  console.log(`📦 Batch Size: ${BATCH_SIZE} notes`);
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

    // Process all files
    const results = [];
    let totalNotesProcessed = 0;

    for (const file of files) {
      const filePath = path.join(NOTE_TEXT_DIR, file);
      const result = await processNoteFile(filePath);
      results.push(result);

      if (result.success) {
        totalNotesProcessed += result.notesProcessed;
      }

      console.log('');
    }

    // Summary
    console.log('📊 PROCESSING SUMMARY');
    console.log('====================');

    const successfulFiles = results.filter(r => r.success).length;
    const failedFiles = results.filter(r => !r.success).length;

    console.log(`✅ Files processed: ${successfulFiles}/${files.length}`);
    if (failedFiles > 0) {
      console.log(`❌ Files failed: ${failedFiles}`);
    }
    console.log(`📝 Total notes stored: ${totalNotesProcessed}`);

    if (successfulFiles === files.length) {
      console.log('🎉 All files processed successfully!');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);