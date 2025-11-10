#!/usr/bin/env node

/**
 * Clinical Notes Extraction Script
 *
 * This script processes all FHIR JSON files in the fhir-data directory,
 * extracts clinical notes from DocumentReference resources, decodes the
 * base64 content, and saves them to text files for validation.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

// Ensure note_text directory exists
if (!fs.existsSync(NOTE_TEXT_DIR)) {
  fs.mkdirSync(NOTE_TEXT_DIR, { recursive: true });
  console.log(`✅ Created note_text directory: ${NOTE_TEXT_DIR}`);
}

/**
 * Extract clinical notes from a FHIR Bundle
 * @param {Object} bundle - FHIR Bundle object
 * @param {string} fileName - Source filename
 * @returns {Array} Array of clinical notes
 */
function extractClinicalNotesFromFHIR(bundle, fileName) {
  const notes = [];

  if (!bundle.entry) return notes;

  bundle.entry.forEach((entry, index) => {
    const resource = entry.resource;

    // Extract from DocumentReference resources
    if (resource.resourceType === 'DocumentReference') {
      try {
        const docRef = resource;

        // Get patient reference
        const patientRef = docRef.subject?.reference || '';
        const patientId = patientRef.replace('urn:uuid:', '').replace('Patient/', '');

        // Get document date
        const date = docRef.date || docRef.created || new Date().toISOString();

        // Get author/doctor info
        let doctor = 'Unknown Provider';
        if (docRef.author && Array.isArray(docRef.author) && docRef.author.length > 0) {
          const author = docRef.author[0];
          if (author.display) {
            doctor = author.display;
          } else if (author.reference?.includes('Practitioner/')) {
            doctor = `Practitioner ${author.reference.split('/')[1]}`;
          }
        }

        // Get organization info
        let organization = '';
        if (docRef.custodian && docRef.custodian.display) {
          organization = docRef.custodian.display;
        }

        // Get content from attachment
        let content = '';
        if (docRef.content && Array.isArray(docRef.content) && docRef.content.length > 0) {
          const attachment = docRef.content[0].attachment;
          if (attachment && attachment.data) {
            // Decode base64 content
            content = Buffer.from(attachment.data, 'base64').toString('utf-8');
          } else if (attachment && attachment.url) {
            content = `[Document URL: ${attachment.url}]`;
          }
        }

        // Get document type
        const noteType = docRef.type?.coding?.[0]?.display ||
                        docRef.type?.text ||
                        docRef.category?.[0]?.coding?.[0]?.display ||
                        'Clinical Note';

        if (content.trim()) {
          notes.push({
            id: docRef.id || `note-${index}`,
            patientId,
            date,
            doctor,
            organization,
            content,
            fileName,
            noteType
          });
        }
      } catch (error) {
        console.warn(`⚠️ Error processing DocumentReference in ${fileName}:`, error.message);
      }
    }

    // Extract from DiagnosticReport resources
    if (resource.resourceType === 'DiagnosticReport') {
      try {
        const report = resource;

        // Get patient reference
        const patientRef = report.subject?.reference || '';
        const patientId = patientRef.replace('urn:uuid:', '').replace('Patient/', '');

        // Get report date
        const date = report.effectiveDateTime || report.issued || new Date().toISOString();

        // Get performer/doctor info
        let doctor = 'Unknown Provider';
        if (report.performer && Array.isArray(report.performer) && report.performer.length > 0) {
          const performer = report.performer[0];
          if (performer.display) {
            doctor = performer.display;
          } else if (performer.reference?.includes('Practitioner/')) {
            doctor = `Practitioner ${performer.reference.split('/')[1]}`;
          }
        }

        // Get organization info
        let organization = '';
        if (report.performingOrganization && report.performingOrganization.display) {
          organization = report.performingOrganization.display;
        }

        // Get conclusion text
        let content = '';
        if (report.conclusion) {
          content = report.conclusion;
        }

        // Add coded results if available
        if (report.result && Array.isArray(report.result)) {
          const results = report.result.map((result) => {
            if (result.display) return result.display;
            if (result.code?.text) return result.code.text;
            return `[Result: ${result.reference}]`;
          });
          if (results.length > 0) {
            content += '\n\nResults:\n' + results.join('\n');
          }
        }

        if (content.trim()) {
          notes.push({
            id: report.id || `report-${index}`,
            patientId,
            date,
            doctor,
            organization,
            content,
            fileName,
            noteType: 'Diagnostic Report'
          });
        }
      } catch (error) {
        console.warn(`⚠️ Error processing DiagnosticReport in ${fileName}:`, error.message);
      }
    }
  });

  return notes;
}

/**
 * Save clinical notes to a text file
 * @param {Array} notes - Array of clinical notes
 * @param {string} sourceFileName - Source FHIR filename
 * @returns {string} Path to saved file
 */
function saveNotesToFile(notes, sourceFileName) {
  if (notes.length === 0) {
    console.log(`ℹ️ No notes to save for ${sourceFileName}`);
    return '';
  }

  try {
    // Generate output filename based on source filename
    const baseName = sourceFileName.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const outputFileName = `${baseName}_extracted_notes.txt`;
    const outputPath = path.join(NOTE_TEXT_DIR, outputFileName);

    // Create file content with metadata and notes
    let fileContent = `CLINICAL NOTES EXTRACTION REPORT\n`;
    fileContent += `================================\n\n`;
    fileContent += `Source File: ${sourceFileName}\n`;
    fileContent += `Extraction Date: ${new Date().toISOString()}\n`;
    fileContent += `Total Notes Extracted: ${notes.length}\n\n`;
    fileContent += `${'='.repeat(50)}\n\n`;

    notes.forEach((note, index) => {
      fileContent += `NOTE ${index + 1}: ${note.noteType}\n`;
      fileContent += `${'-'.repeat(40)}\n`;
      fileContent += `Note ID: ${note.id}\n`;
      fileContent += `Patient ID: ${note.patientId}\n`;
      fileContent += `Date: ${note.date}\n`;
      fileContent += `Provider: ${note.doctor}\n`;
      fileContent += `Organization: ${note.organization}\n`;
      fileContent += `Content Length: ${note.content.length} characters\n\n`;

      fileContent += `CLINICAL CONTENT:\n${note.content}\n\n`;

      fileContent += `${'='.repeat(50)}\n\n`;
    });

    // Write the file
    fs.writeFileSync(outputPath, fileContent, 'utf8');

    return outputPath;

  } catch (error) {
    console.error(`❌ Error saving notes to file for ${sourceFileName}:`, error);
    throw error;
  }
}

/**
 * Process a single FHIR file
 * @param {string} filePath - Path to FHIR JSON file
 */
async function processFHIRFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n🔄 Processing: ${fileName}`);

  try {
    // Read and parse FHIR file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const fhirData = JSON.parse(fileContent);

    // Extract clinical notes
    const notes = extractClinicalNotesFromFHIR(fhirData, fileName);

    if (notes.length === 0) {
      console.log(`ℹ️ No clinical notes found in ${fileName}`);
      return { fileName, notesExtracted: 0, savedFile: null };
    }

    // Save notes to file
    const savedFilePath = saveNotesToFile(notes, fileName);

    console.log(`✅ Success: ${notes.length} notes extracted and saved to ${path.basename(savedFilePath)}`);
    return { fileName, notesExtracted: notes.length, savedFile: savedFilePath };

  } catch (error) {
    console.error(`❌ Error processing ${fileName}:`, error.message);
    return { fileName, notesExtracted: 0, savedFile: null, error: error.message };
  }
}

/**
 * Main processing function
 */
async function main() {
  console.log('🏥 Clinical Notes Extraction Script');
  console.log('==================================');
  console.log(`📂 FHIR Data Directory: ${FHIR_DATA_DIR}`);
  console.log(`📝 Output Directory: ${NOTE_TEXT_DIR}`);

  try {
    // Get all JSON files in fhir-data directory
    const fhirFiles = fs.readdirSync(FHIR_DATA_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(FHIR_DATA_DIR, file));

    if (fhirFiles.length === 0) {
      console.log('❌ No FHIR JSON files found in fhir-data directory');
      return;
    }

    console.log(`\n📋 Found ${fhirFiles.length} FHIR files to process`);

    // Process each file
    const results = [];
    for (const filePath of fhirFiles) {
      const result = await processFHIRFile(filePath);
      results.push(result);
    }

    // Summary
    console.log('\n📊 EXTRACTION SUMMARY');
    console.log('=====================');

    let totalNotes = 0;
    let successfulFiles = 0;
    let errors = [];

    results.forEach(result => {
      totalNotes += result.notesExtracted;
      if (result.savedFile) {
        successfulFiles++;
      }
      if (result.error) {
        errors.push(`${result.fileName}: ${result.error}`);
      }
    });

    console.log(`✅ Files processed: ${results.length}`);
    console.log(`✅ Successful extractions: ${successfulFiles}`);
    console.log(`📝 Total notes extracted: ${totalNotes}`);

    if (errors.length > 0) {
      console.log(`\n⚠️ Errors encountered:`);
      errors.forEach(error => console.log(`   - ${error}`));
    }

    console.log('\n🎉 Extraction complete!');
    console.log(`💾 All saved files are in: ${NOTE_TEXT_DIR}`);

  } catch (error) {
    console.error('\n💥 Fatal error during processing:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { extractClinicalNotesFromFHIR, saveNotesToFile, processFHIRFile };