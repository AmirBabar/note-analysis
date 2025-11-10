#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const FHIR_FILE = path.join(__dirname, 'fhir-data', 'Abe604_Wisoky380_aec13191-93cd-547a-7b66-0267d435ab10.json');

console.log('🔍 Debug: Extracting one note to see content...');

try {
  const content = fs.readFileSync(FHIR_FILE, 'utf-8');
  const bundle = JSON.parse(content);

  // Find first DocumentReference
  const docRef = bundle.entry.find(e => e.resource.resourceType === 'DocumentReference');

  if (docRef) {
    const resource = docRef.resource;
    console.log(`📄 Found DocumentReference: ${resource.id}`);

    const attachment = resource.content?.[0]?.attachment;
    if (attachment?.data) {
      console.log(`📎 Content Type: ${attachment.contentType}`);
      console.log(`📏 Data Length: ${attachment.data.length} characters`);

      // Decode and show first 500 characters
      const decoded = Buffer.from(attachment.data, 'base64').toString('utf-8');
      console.log(`\n📝 First 500 characters of decoded content:`);
      console.log('=' * 50);
      console.log(decoded.substring(0, 500));
      console.log('=' * 50);
      console.log(`\n📊 Total content length: ${decoded.length} characters`);
    } else {
      console.log('❌ No attachment data found');
    }
  } else {
    console.log('❌ No DocumentReference found');
  }

} catch (error) {
  console.error('💥 Error:', error.message);
}