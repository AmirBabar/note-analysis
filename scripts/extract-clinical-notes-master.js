#!/usr/bin/env node

/**
 * Master Clinical Note Extraction Script
 *
 * This is the definitive extraction script with:
 * - Comprehensive template cleaning
 * - Robust HTML parsing with Cheerio
 * - Support for DocumentReference, DiagnosticReport, and Observation resources
 * - Output to note_text files for RAG processing
 */

const fs = require('fs').promises;
const path = require('path');
const { load } = require('cheerio');

const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

/**
 * ⭐️ COMPREHENSIVE: Validates and cleans extracted text.
 * Removes templates, HTML, markdown, and empty fields.
 */
function cleanAndValidateText(text) {
  if (!text || text.trim().length < 20) {
    return { valid: false, reason: 'Too short', text: null };
  }

  // 1. Use Cheerio to parse HTML and get only the text
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
    return { valid: false, reason: 'Pure template', text: null };
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
  if (cleanText.length < 50) {
    return { valid: false, reason: 'Too short after cleaning', text: null };
  }

  return { valid: true, reason: 'Valid', text: cleanText };
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
        if (attachment?.data) {
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

      if (text) {
        const validation = cleanAndValidateText(text);

        if (validation.valid && validation.text) {
          notes.push({
            text: validation.text,
            metadata: noteMetadata
          });
        }
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
  console.log('🚀 Starting Master Clinical Text Extraction...');

  try {
    await fs.mkdir(NOTE_TEXT_DIR, { recursive: true });

    const files = await fs.readdir(FHIR_DATA_DIR);
    const fhirFiles = files.filter(f => f.endsWith('.json'));

    console.log(`📋 Found ${fhirFiles.length} FHIR files to process.`);

    let totalValidNotes = 0;

    for (const file of fhirFiles) {
      console.log(`\n📁 Processing: ${file}`);

      const filePath = path.join(FHIR_DATA_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const bundle = JSON.parse(content);

      const notes = extractNotesFromFHIR(bundle, file);

      if (notes.length === 0) {
        console.log('  ⚠️ No valid clinical notes found');
        continue;
      }

      console.log(`  📊 Found ${notes.length} valid notes`);

      totalValidNotes += notes.length;

      // Save to file
      const outputFile = path.join(NOTE_TEXT_DIR, `${path.basename(file, '.json')}_extracted_notes.txt`);
      let fileContent = `# Clinical Notes from ${file}\n\n`;

      notes.forEach((note, index) => {
        fileContent += `## Note ${index + 1} (${note.metadata.source} - ${note.metadata.note_id})\n\n`;
        fileContent += `**Note ID:** ${note.metadata.note_id}\n`;
        fileContent += `**Patient ID:** ${note.metadata.patient_id}\n`;
        fileContent += `**Note Type:** ${note.metadata.note_type}\n`;
        fileContent += `**Provider:** ${note.metadata.provider}\n`;
        fileContent += `**Date:** ${note.metadata.note_date || 'Unknown'}\n`;
        fileContent += `**Source:** ${note.metadata.source_file}\n\n`;
        fileContent += `**Clinical Content:**\n`;
        fileContent += `${note.text}\n\n`;
        fileContent += `${'='.repeat(60)}\n\n`;
      });

      await fs.writeFile(outputFile, fileContent, 'utf-8');
      console.log(`  ✅ Saved ${notes.length} notes to ${outputFile}`);
    }

    console.log(`\n📊 EXTRACTION SUMMARY`);
    console.log('=====================');
    console.log(`✅ Files processed: ${fhirFiles.length}`);
    console.log(`📝 Total valid notes extracted: ${totalValidNotes}`);
    console.log(`📂 Output directory: ${NOTE_TEXT_DIR}`);

    if (totalValidNotes > 0) {
      console.log('\n🎉 Extraction complete! Notes are ready for RAG processing.');
      console.log('\n💡 Next steps:');
      console.log('1. Review the extracted notes in note_text/ directory');
      console.log('2. Run RAG loading script when ready: node scripts/load-clinical-notes-rag.js');
    } else {
      console.log('\n⚠️ No clinical notes found. Check FHIR data content.');
    }

  } catch (error) {
    console.error('\n💥 Fatal error during extraction:', error);
    process.exit(1);
  }
}

main();