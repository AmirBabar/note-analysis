#!/usr/bin/env node

/**
 * Debug script to examine what content is available in FHIR files
 */

const fs = require('fs').promises;
const path = require('path');

const FHIR_DATA_DIR = path.join(__dirname, '../fhir-data');

function cleanAndValidateText(text) {
  if (!text || text.trim().length < 100) {
    return { valid: false, reason: 'Too short' };
  }

  const templateMarkers = [
    "[list any specific symptoms",
    "[Insert Date]",
    "This medical note is a template"
  ];

  for (const marker of templateMarkers) {
    if (text.includes(marker)) {
      return { valid: false, reason: `Contains template marker: "${marker}"` };
    }
  }

  return { valid: true, reason: 'Valid' };
}

async function debugFHIRFiles() {
  console.log('🔍 DEBUG: Examining FHIR file contents...');

  const files = await fs.readdir(FHIR_DATA_DIR);
  const fhirFiles = files.filter(f => f.endsWith('.json')).slice(0, 2); // Check first 2 files

  for (const file of fhirFiles) {
    console.log(`\n📁 File: ${file}`);
    console.log('='.repeat(50));

    const filePath = path.join(FHIR_DATA_DIR, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const bundle = JSON.parse(content);

    if (!bundle.entry) {
      console.log('❌ No entries in bundle');
      continue;
    }

    const resources = bundle.entry.map(e => e.resource);
    const resourceTypes = [...new Set(resources.map(r => r.resourceType))];

    console.log(`📋 Total resources: ${resources.length}`);
    console.log(`📋 Resource types: ${resourceTypes.join(', ')}`);

    // Check each resource type for text content
    let contentFound = 0;

    for (const resource of resources) {
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
        contentFound++;
        const validation = cleanAndValidateText(text);

        console.log(`\n📄 ${source} (${resource.id}):`);
        console.log(`   Length: ${text.length} chars`);
        console.log(`   Valid: ${validation.valid ? '✅' : '❌'} ${validation.reason}`);

        if (text.length > 0) {
          const preview = text.replace(/\n/g, ' ').substring(0, 200);
          console.log(`   Preview: "${preview}${text.length > 200 ? '...' : ''}"`);
        }

        if (validation.valid && contentFound <= 3) { // Show first 3 valid ones
          console.log(`   Full content (first 500 chars):`);
          console.log(`   "${text.substring(0, 500).replace(/\n/g, ' ')}..."`);
        }
      }
    }

    console.log(`\n📊 Summary: Found ${contentFound} resources with text content`);

    if (contentFound === 0) {
      console.log('❌ No text content found in any resources');
    }
  }
}

debugFHIRFiles().catch(console.error);