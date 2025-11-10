#!/usr/bin/env node

/**
 * Test script to check specific file processing
 */

const fs = require('fs').promises;
const path = require('path');

// Copy functions from final script for testing
function cleanAndValidateText(text) {
  if (!text || text.trim().length < 100) {
    return null;
  }

  const templateMarkers = [
    "[list any specific symptoms",
    "[Insert Date]",
    "This medical note is a template"
  ];

  if (templateMarkers.some(marker => text.includes(marker))) {
    return null;
  }

  let cleanText = text.replace(/<[^>]+>/g, ' ');
  cleanText = cleanText.replace(/\s\s+/g, ' ').trim();

  return cleanText;
}

function extractNotesDataFromFHIR(bundle, fileName) {
  const notesData = [];
  if (!bundle.entry) return notesData;

  const patientResource = bundle.entry.find(
    e => e.resource.resourceType === 'Patient'
  )?.resource;

  if (!patientResource) return notesData;
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

async function testSpecificFile() {
  const fileName = "Aaron697_Welch179_a11e4432-51c0-f464-b06f-49fedbd7a9f1.json";
  const filePath = path.join(__dirname, '../fhir-data', fileName);

  console.log(`🔍 Testing file: ${fileName}`);

  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const bundle = JSON.parse(fileContent);

    // Test the extraction function directly
    const notesData = extractNotesDataFromFHIR(bundle, fileName);

    console.log(`📊 Found ${notesData.length} valid notes`);

    if (notesData.length > 0) {
      console.log('\n✅ Valid notes found:');
      notesData.forEach((note, index) => {
        console.log(`${index + 1}. Note ID: ${note.metadata.note_id}`);
        console.log(`   Type: ${note.metadata.note_type}`);
        console.log(`   Length: ${note.cleanText.length} chars`);
        console.log(`   Preview: "${note.cleanText.substring(0, 100).replace(/\n/g, ' ')}..."`);
        console.log('');
      });
    } else {
      console.log('❌ No valid notes found');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

testSpecificFile();