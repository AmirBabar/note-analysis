#!/usr/bin/env node

/**
 * Clinical Text Extraction to Files
 *
 * This script extracts clinical text from FHIR files and saves valid notes
 * to the note_text directory for processing.
 */

const fs = require('fs').promises;
const path = require('path');
const { load } = require('cheerio');

const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

/**
 * Validates and cleans extracted text with Cheerio HTML parsing.
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
    "This medical note is a template"
  ];

  // If the note is just a template warning, discard it
  if (cleanText.includes(templateMarkers[0]) ||
     (cleanText.includes(templateMarkers[1]) && cleanText.length < 200)) {
    return null;
  }

  // 3. Clean Template Artifacts

  // Removes bracketed placeholders like [Insert Date] or [Your Name]
  cleanText = cleanText.replace(/\[[^\]]+\]/g, ' ');

  // Removes instructional text like (If known...)
  cleanText = cleanText.replace(/\(If known, e\.g\., "[^"]+"\)/g, ' ');
  cleanText = cleanText.replace(/\(Document any relevant history, e\.g\., [^)]+\)/g, ' ');

  // Removes the "Note: This medical note is a template..." footer
  cleanText = cleanText.replace(/Note: This medical note is a template[\s\S]*/g, ' ');

  // Remove markdown-like artifacts
  cleanText = cleanText.replace(/(\*\*|__|\*|_|---|===)/g, ' ');

  // Remove "empty fields" (e.g., "Reports .", "Symptoms began .")
  cleanText = cleanText.replace(/([A-Z][a-z\s]+):\s*\./g, ' ');

  // Additional cleaning for common template remnants
  cleanText = cleanText.replace(/Medical Scribe/g, '');
  cleanText = cleanText.replace(/\*\*\*Provider Signature:\*\*[\s\S]*/g, '');
  cleanText = cleanText.replace(/\*\*\*Signature:\*\*[\s\S]*/g, '');
  cleanText = cleanText.replace(/Reports \./g, 'Reports none');
  cleanText = cleanText.replace(/Symptoms began \./g, 'Symptom onset not specified');
  cleanText = cleanText.replace(/Duration of Symptoms: \./g, 'Duration not specified');

  // 4. Normalize whitespace (run this *last*)
  cleanText = cleanText.replace(/\s\s+/g, ' ').trim();

  // 5. Final validation after cleaning
  if (cleanText.length < 50) { // Check length *after* cleaning
    return null; // Skip if cleaning removed everything
  }

  return cleanText;
}

/**
 * Extracts clinical notes from FHIR bundle
 */
function extractNotesFromFHIR(bundle, fileName) {
  const notes = [];
  if (!bundle.entry) return notes;

  const patientResource = bundle.entry.find(
    e => e.resource.resourceType === 'Patient'
  )?.resource;

  if (!patientResource) return notes;
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

      if (resource.resourceType === 'DocumentReference') {
        noteMetadata.note_date = resource.date;
        noteMetadata.note_type = resource.type?.text || 'DocumentReference';
        noteMetadata.provider = resource.author?.[0]?.display || 'Unknown';

        const attachment = resource.content?.[0]?.attachment;
        if (attachment?.contentType === 'text/plain' && attachment?.data) {
          text = Buffer.from(attachment.data, 'base64').toString('utf-8');
        } else if (attachment?.contentType.includes('html') && attachment?.data) {
          text = Buffer.from(attachment.data, 'base64').toString('utf-8');
        }
      } else if (resource.resourceType === 'DiagnosticReport') {
        noteMetadata.note_date = resource.effectiveDateTime || resource.issued;
        noteMetadata.note_type = resource.code?.text || 'DiagnosticReport';
        noteMetadata.provider = resource.performer?.[0]?.display || 'Unknown';

        if (resource.text?.div) {
          text = resource.text.div;
        }
      } else if (resource.resourceType === 'Observation') {
        if (resource.note && resource.note.length > 0) {
          text = resource.note.map(n => n.text).join('\n');
          noteMetadata.note_date = resource.effectiveDateTime || resource.issued;
          noteMetadata.note_type = resource.code?.text || 'Observation Note';
          noteMetadata.provider = resource.performer?.[0]?.display || 'Unknown';
        }
      }

      const cleanText = cleanAndValidateText(text);

      if (cleanText) {
        notes.push({
          cleanText,
          metadata: noteMetadata
        });
      }

    } catch (error) {
      console.warn(`Skipping resource in ${fileName} due to error: ${error.message}`);
    }
  });

  return notes;
}

/**
 * Main extraction function
 */
async function main() {
  console.log('🚀 Starting Clinical Text Extraction to Files...');

  try {
    // Ensure note_text directory exists
    await fs.mkdir(NOTE_TEXT_DIR, { recursive: true });

    const files = await fs.readdir(FHIR_DATA_DIR);
    const fhirFiles = files.filter(f => f.endsWith('.json'));

    console.log(`📋 Found ${fhirFiles.length} FHIR files to process.`);

    let totalNotesExtracted = 0;
    let filesWithNotes = 0;

    for (const file of fhirFiles) {
      console.log(`\n📁 Processing: ${file}`);

      const filePath = path.join(FHIR_DATA_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const bundle = JSON.parse(content);

      const notes = extractNotesFromFHIR(bundle, file);

      if (notes.length > 0) {
        filesWithNotes++;
        totalNotesExtracted += notes.length;

        // Create output file
        const outputFile = path.join(NOTE_TEXT_DIR, `${path.basename(file, '.json')}_extracted_notes.txt`);

        let fileContent = `# Clinical Notes Extracted from ${file}\n`;
        fileContent += `# Generated: ${new Date().toISOString()}\n`;
        fileContent += `# Total Notes: ${notes.length}\n\n`;
        fileContent += `${'='.repeat(80)}\n\n`;

        notes.forEach((note, index) => {
          fileContent += `## Note ${index + 1}\n`;
          fileContent += `**Note ID:** ${note.metadata.note_id}\n`;
          fileContent += `**Patient ID:** ${note.metadata.patient_id}\n`;
          fileContent += `**Note Type:** ${note.metadata.note_type}\n`;
          fileContent += `**Provider:** ${note.metadata.provider}\n`;
          fileContent += `**Date:** ${note.metadata.note_date || 'Unknown'}\n`;
          fileContent += `**Source:** ${note.metadata.source_file}\n\n`;
          fileContent += `**Clinical Content:**\n`;
          fileContent += `${note.cleanText}\n\n`;
          fileContent += `${'='.repeat(80)}\n\n`;
        });

        await fs.writeFile(outputFile, fileContent, 'utf-8');
        console.log(`  ✅ Extracted ${notes.length} notes → ${outputFile}`);
      } else {
        console.log(`  ⚠️ No valid clinical notes found in ${file}`);
      }
    }

    console.log('\n📊 EXTRACTION SUMMARY');
    console.log('======================');
    console.log(`✅ Files processed: ${fhirFiles.length}`);
    console.log(`✅ Files with notes: ${filesWithNotes}`);
    console.log(`📝 Total notes extracted: ${totalNotesExtracted}`);
    console.log(`📂 Output directory: ${NOTE_TEXT_DIR}`);

    if (totalNotesExtracted > 0) {
      console.log('\n🎉 Extraction complete! Ready for RAG processing.');
    } else {
      console.log('\n⚠️ No clinical notes found. Check FHIR data content.');
    }

  } catch (error) {
    console.error('\n💥 Fatal error during extraction:', error);
    process.exit(1);
  }
}

main();