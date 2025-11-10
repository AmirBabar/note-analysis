#!/usr/bin/env node

/**
 * Simple extraction script based on debug script that worked
 */

const fs = require('fs').promises;
const path = require('path');
const { load } = require('cheerio');

const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');
const NOTE_TEXT_DIR = path.join(__dirname, '../note_text');

/**
 * ⭐️ UPDATED: Validates and cleans extracted text.
 * Removes templates, HTML, markdown, and empty fields.
 */
function cleanAndValidateText(text) {
  if (!text || text.trim().length < 20) {
    return { valid: false, reason: 'Too short', text: null };
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

  // ⭐️ NEW: Remove markdown-like artifacts
  cleanText = cleanText.replace(/(\*\*|__|\*|_|---|===)/g, ' ');

  // ⭐️ NEW: Remove "empty fields" (e.g., "Reports .", "Symptoms began .")
  // This looks for a capitalized phrase, a colon, optional space, and then just a period.
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
    return { valid: false, reason: 'Too short after cleaning', text: null };
  }

  return { valid: true, reason: 'Valid', text: cleanText };
}

async function simpleExtract() {
  console.log('🔍 Simple Clinical Text Extraction...');

  await fs.mkdir(NOTE_TEXT_DIR, { recursive: true });

  const files = await fs.readdir(FHIR_DATA_DIR);
  const fhirFiles = files.filter(f => f.endsWith('.json')); // Process all files

  let totalValidNotes = 0;

  for (const file of fhirFiles) {
    console.log(`\n📁 File: ${file}`);

    const filePath = path.join(FHIR_DATA_DIR, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const bundle = JSON.parse(content);

    if (!bundle.entry) continue;

    const validNotes = [];

    for (const entry of bundle.entry) {
      const resource = entry.resource;
      let text = null;
      let source = '';

      if (resource.resourceType === 'DocumentReference') {
        source = 'DocumentReference';
        const attachment = resource.content?.[0]?.attachment;
        if (attachment?.data) {
          text = Buffer.from(attachment.data, 'base64').toString('utf-8');
        }
      } else if (resource.resourceType === 'DiagnosticReport') {
        source = 'DiagnosticReport';
        if (resource.text?.div) {
          text = resource.text.div;
        }
      } else if (resource.resourceType === 'Observation') {
        source = 'Observation';
        if (resource.note && resource.note.length > 0) {
          text = resource.note.map(n => n.text).join('\n');
        }
      }

      if (text) {
        const validation = cleanAndValidateText(text);

        if (validation.valid && validation.text) {
          validNotes.push({
            text: validation.text,
            source: source,
            id: resource.id
          });
        }
      }
    }

    console.log(`📊 Found ${validNotes.length} valid notes in ${file}`);

    if (validNotes.length > 0) {
      totalValidNotes += validNotes.length;

      // Save to file
      const outputFile = path.join(NOTE_TEXT_DIR, `${path.basename(file, '.json')}_extracted_notes.txt`);
      let fileContent = `# Clinical Notes from ${file}\n\n`;

      validNotes.forEach((note, index) => {
        fileContent += `## Note ${index + 1} (${note.source} - ${note.id})\n\n`;
        fileContent += `${note.text}\n\n`;
        fileContent += `${'='.repeat(60)}\n\n`;
      });

      await fs.writeFile(outputFile, fileContent, 'utf-8');
      console.log(`✅ Saved ${validNotes.length} notes to ${outputFile}`);
    }
  }

  console.log(`\n🎉 Total valid notes extracted: ${totalValidNotes}`);

  if (totalValidNotes > 0) {
    console.log('✅ Extraction successful! Ready for RAG processing.');
  }
}

simpleExtract().catch(console.error);