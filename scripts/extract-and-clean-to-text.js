#!/usr/bin/env node

/**
 * FHIR Clinical Note Extraction-to-Text Pipeline (Robust Cleaning)
 *
 * This script processes FHIR JSON files, extracts and cleans clinical text
 * using robust, pattern-matching cleaning functions, and then writes the final
 * clean text to a .txt file in the /note_text directory.
 */

const fs = require('fs').promises;
const path = require('path');
const { load } = require('cheerio'); // For robust HTML stripping

// --- Configuration ---
const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

// --- Helper Functions ---

/**
 * ⭐️ FINAL ROBUST VERSION (v3): Validates and cleans extracted text.
 * Now targets the specific junk patterns from Abram53 and Adah626.
 */
function cleanAndValidateText(text) {
  if (!text || text.trim().length < 20) {
    return null; // Skip if text is too short
  }

  // 1. Use Cheerio to parse HTML and get only the text
  // This will strip all <div>, <p>, <b>, etc.
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

  // ⭐️ NEW: Removes specific "empty" template fields from your files
  // This looks for "Label: ." or "Label: [anything with a period]."
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
 * ⭐️ FINAL: Extracts text from FHIR and returns structured data.
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
      return { fileName, notesExtracted: 0 };
    }

    console.log(`  - Extracted ${notesToProcess.length} valid notes.`);

    // 2. Format the notes into a single string (like the old script)
    let noteCounter = 1;
    const formattedOutput = notesToProcess.map(note => {
      const output = [
        `============================================================`,
        `## Note ${noteCounter++} (Type: ${note.metadata.note_type} - ID: ${note.metadata.note_id})`,
        `Patient ID: ${note.metadata.patient_id}`,
        `Date: ${note.metadata.note_date || 'N/A'}`,
        `Provider: ${note.metadata.provider}`,
        `Source: ${fileName}`,
        `\n**Clinical Content:**`,
        note.cleanText
      ];
      return output.join('\n');
    });
    
    const finalOutputString = formattedOutput.join('\n\n');

    // 3. Write the formatted string to a .txt file
    const outputFileName = `${path.basename(filePath, '.json')}_extracted_notes.txt`;
    const outputFilePath = path.join(NOTE_TEXT_DIR, outputFileName);

    await fs.writeFile(outputFilePath, finalOutputString);
    console.log(`  - Successfully saved clean text to ${outputFileName}`);
    
    return { fileName, notesExtracted: notesToProcess.length };

  } catch (error) {
    console.error(`  - 💥 FAILED to process ${fileName}: ${error.message}`);
    return { fileName, notesExtracted: 0, error: error.message };
  }
}

/**
 * Helper to ensure the output directory exists.
 */
async function ensureDirExists(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * ⭐️ Main execution function.
 */
async function main() {
  console.log('🚀 Starting FHIR Clean-to-Text Pipeline...');

  try {
    // Ensure the output directory exists
    await ensureDirExists(NOTE_TEXT_DIR);
    console.log(`Output directory set to: ${NOTE_TEXT_DIR}`);

    const files = await fs.readdir(FHIR_DATA_DIR);
    const fhirFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(FHIR_DATA_DIR, f));

    if (fhirFiles.length === 0) {
      console.warn(`No FHIR .json files found in ${FHIR_DATA_DIR}`);
      return;
    }

    console.log(`📋 Found ${fhirFiles.length} FHIR files to process.`);

    let totalNotes = 0;
    let successfulFiles = 0;
    const errors = [];

    // Process all files
    for (const filePath of fhirFiles) {
      const result = await processFHIRFile(filePath);
      if (result.notesExtracted > 0) {
        successfulFiles++;
        totalNotes += result.notesExtracted;
      }
      if (result.error) {
        errors.push(`${result.fileName}: ${result.error}`);
      }
    }

    // Summary
    console.log('\n📊 EXTRACTION SUMMARY');
    console.log('=====================');
    console.log(`✅ Files processed: ${fhirFiles.length}`);
    console.log(`✅ Files with data extracted: ${successfulFiles}`);
    console.log(`📝 Total clean notes written: ${totalNotes}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Errors encountered:`);
      errors.forEach(error => console.log(`   - ${error}`));
    }
    console.log('\n🎉 Extraction complete!');

  } catch (error) {
    console.error('\n💥 Fatal error during processing:', error);
    process.exit(1);
  }
}

main();