#!/usr/bin/env node

/**
 * Test Database Write Script
 *
 * This script tests writing clinical notes to Supabase without embeddings
 * to verify the database connection and table structure work correctly.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Configuration
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

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
 * Parse a note text file and extract individual notes
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
 * Store note in database without embedding
 */
async function storeNoteWithoutEmbedding(note) {
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
        clinical_content: note.clinicalContent,
        source_file: note.sourceFile,
        embedding: null, // No embedding for now
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
 * Test database connection and table structure
 */
async function testDatabaseConnection() {
  try {
    console.log('🔄 Testing database connection...');

    // Test basic connection by trying to select from the table
    const { data, error } = await supabase
      .from('clinical_notes_embeddings')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Database connection failed:', error);
      return false;
    }

    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection error:', error);
    return false;
  }
}

/**
 * Process a single note file for testing
 */
async function processNoteFileForTest(filePath, maxNotes = 5) {
  const fileName = path.basename(filePath);
  console.log(`🔄 Testing: ${fileName}`);

  try {
    const notes = parseNoteFile(filePath);

    if (notes.length === 0) {
      console.log(`ℹ️ No notes found in ${fileName}`);
      return { fileName, notesProcessed: 0, success: true };
    }

    console.log(`📝 Found ${notes.length} notes in ${fileName} (testing first ${maxNotes})`);

    // Only process first few notes for testing
    const testNotes = notes.slice(0, maxNotes);
    let successCount = 0;

    for (const note of testNotes) {
      const stored = await storeNoteWithoutEmbedding(note);
      if (stored) {
        successCount++;
        console.log(`✅ Stored note ${note.noteId}`);
      }
    }

    console.log(`✅ Test completed for ${fileName}: ${successCount}/${testNotes.length} notes stored`);
    return { fileName, notesProcessed: successCount, totalNotes: notes.length, success: true };

  } catch (error) {
    console.error(`❌ Error testing ${fileName}:`, error.message);
    return { fileName, notesProcessed: 0, success: false, error: error.message };
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('🧪 Database Write Test Script');
  console.log('==============================');
  console.log(`📂 Note Text Directory: ${NOTE_TEXT_DIR}`);
  console.log('');

  try {
    // Test database connection first
    const connectionOk = await testDatabaseConnection();
    if (!connectionOk) {
      process.exit(1);
    }

    console.log('');

    // Check if note_text directory exists
    if (!fs.existsSync(NOTE_TEXT_DIR)) {
      console.error('❌ note_text directory not found');
      process.exit(1);
    }

    // Get all note text files
    const files = fs.readdirSync(NOTE_TEXT_DIR).filter(file => file.endsWith('_extracted_notes.txt'));

    if (files.length === 0) {
      console.log('ℹ️ No note text files found to test');
      return;
    }

    console.log(`📋 Found ${files.length} note text files to test`);
    console.log('');

    // Test with just the first file
    const firstFile = files[0];
    const filePath = path.join(NOTE_TEXT_DIR, firstFile);
    const result = await processNoteFileForTest(filePath, 3); // Test only 3 notes

    console.log('');
    console.log('📊 TEST SUMMARY');
    console.log('================');

    if (result.success) {
      console.log(`✅ File: ${result.fileName}`);
      console.log(`📝 Notes stored: ${result.notesProcessed}`);
      console.log(`📊 Total notes in file: ${result.totalNotes}`);
      console.log('🎉 Database write test completed successfully!');
    } else {
      console.log(`❌ File: ${result.fileName}`);
      console.log(`❌ Error: ${result.error}`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);