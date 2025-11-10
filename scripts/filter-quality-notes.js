const fs = require('fs');
const path = require('path');

const NOTE_TEXT_DIR = path.join(__dirname, '..', 'note_text');
const CLEAN_DIR = path.join(__dirname, '..', 'note_text_clean');

// Template indicators to filter out
const TEMPLATE_INDICATORS = [
  'for .',  // Empty fields like "Reason for Visit: General examination for ."
  'Reports .',  // Empty ROS entries
  'Advised on .',  // Empty plan items
  'Consider if symptoms persist',  // Generic plan text
  'Follow-up scheduled as needed',  // Generic follow-up text
  'Symptoms reported (if any) may be related to .',  // Empty assessment
  'No acute pathology identified',  // Generic when no real findings
  'Template',
  '[Insert',
  '(If known',
  'Please specify',
  'Unknown',
  'N/A',
  '.',
  '..',
  '...',
];

// Minimum requirements for a note to be considered quality
const MIN_CONTENT_LENGTH = 200; // characters
const MIN_SENTENCES = 3;
const MUST_HAVE_MEDICAL_TERMS = 3;

// Common medical terms that indicate real clinical content
const MEDICAL_TERMS = [
  'blood pressure', 'hypertension', 'diabetes', 'cholesterol', 'medication', 'prescription',
  'diagnosis', 'treatment', 'symptoms', 'pain', 'fever', 'cough', 'headache', 'nausea',
  'vomiting', 'diarrhea', 'chest pain', 'shortness of breath', 'fatigue', 'weakness',
  'weight', 'height', 'BMI', 'allergies', 'asthma', 'arthritis', 'depression',
  'anxiety', 'insomnia', 'screening', 'vaccination', 'lab results', 'x-ray',
  'ECG', 'MRI', 'CT scan', 'ultrasound', 'biopsy', 'surgery', 'procedure',
  'follow-up', 'monitoring', 'therapy', 'rehabilitation', 'consultation',
  'examination', 'assessment', 'diagnostic', 'prognosis', 'recommendations'
];

function isTemplateContent(text) {
  const lowerText = text.toLowerCase();

  // Check for obvious template markers
  for (const indicator of TEMPLATE_INDICATORS) {
    if (lowerText.includes(indicator.toLowerCase())) {
      return true;
    }
  }

  // Check for patterns that suggest template content
  if (lowerText.includes('patient reports') && lowerText.includes('.')) {
    // "patient reports ." suggests empty field
    return true;
  }

  return false;
}

function hasEnoughMedicalTerms(text) {
  const lowerText = text.toLowerCase();
  let termCount = 0;

  for (const term of MEDICAL_TERMS) {
    if (lowerText.includes(term.toLowerCase())) {
      termCount++;
    }
  }

  return termCount >= MUST_HAVE_MEDICAL_TERMS;
}

function countSentences(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  return sentences.length;
}

function filterNoteContent(content) {
  // Remove headers and metadata
  const lines = content.split('\n');
  const contentLines = [];
  let inContent = false;

  for (const line of lines) {
    if (line.startsWith('**Clinical Content:**')) {
      inContent = true;
      continue;
    }
    if (line.startsWith('============================================================')) {
      inContent = false;
      continue;
    }
    if (inContent && line.trim()) {
      contentLines.push(line.trim());
    }
  }

  const cleanContent = contentLines.join(' ');

  // Basic quality checks
  if (cleanContent.length < MIN_CONTENT_LENGTH) {
    return { quality: false, reason: 'Too short', cleanedContent: '' };
  }

  if (isTemplateContent(cleanContent)) {
    return { quality: false, reason: 'Template content detected', cleanedContent: '' };
  }

  if (countSentences(cleanContent) < MIN_SENTENCES) {
    return { quality: false, reason: 'Too few sentences', cleanedContent: '' };
  }

  if (!hasEnoughMedicalTerms(cleanContent)) {
    return { quality: false, reason: 'Insufficient medical terminology', cleanedContent: '' };
  }

  return { quality: true, reason: 'High quality', cleanedContent: cleanContent };
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  // Split into individual notes
  const noteSections = content.split(/\n============================================================\n/);
  const qualityNotes = [];

  for (let i = 0; i < noteSections.length; i++) {
    const section = noteSections[i];
    if (!section.includes('**Clinical Content:**')) continue;

    const qualityCheck = filterNoteContent(section);
    if (qualityCheck.quality) {
      qualityNotes.push(qualityCheck.cleanedContent);
    }
  }

  return {
    fileName,
    originalNotes: noteSections.length - 1,
    qualityNotes: qualityNotes.length,
    notes: qualityNotes
  };
}

function main() {
  console.log('🔍 Filtering High-Quality Clinical Notes...');

  // Create clean directory
  if (!fs.existsSync(CLEAN_DIR)) {
    fs.mkdirSync(CLEAN_DIR, { recursive: true });
  }

  const files = fs.readdirSync(NOTE_TEXT_DIR).filter(f => f.endsWith('.txt'));
  console.log(`📁 Found ${files.length} files to filter`);

  const results = [];
  let totalOriginalNotes = 0;
  let totalQualityNotes = 0;

  for (const file of files) {
    const filePath = path.join(NOTE_TEXT_DIR, file);
    console.log(`\n📋 Processing: ${file}`);

    const result = processFile(filePath);
    totalOriginalNotes += result.originalNotes;
    totalQualityNotes += result.qualityNotes;

    if (result.qualityNotes > 0) {
      // Create clean file with only quality notes
      const cleanContent = result.notes.map((note, index) =>
        `## Quality Note ${index + 1}\n\n${note}\n\n---`
      ).join('');

      const cleanFilePath = path.join(CLEAN_DIR, file.replace('.txt', '_clean.txt'));
      fs.writeFileSync(cleanFilePath, cleanContent);

      console.log(`  ✅ Kept ${result.qualityNotes} high-quality notes`);
      console.log(`  📝 Saved to: ${path.basename(cleanFilePath)}`);
    } else {
      console.log(`  ❌ No quality notes found`);
    }

    results.push(result);
  }

  console.log('\n📊 FILTERING SUMMARY');
  console.log('=====================');
  console.log(`✅ Files processed: ${files.length}`);
  console.log(`📝 Original notes: ${totalOriginalNotes}`);
  console.log(`🎯 Quality notes: ${totalQualityNotes}`);
  console.log(`📈 Quality ratio: ${((totalQualityNotes / totalOriginalNotes) * 100).toFixed(1)}%`);
  console.log(`📂 Clean directory: ${CLEAN_DIR}`);

  if (totalQualityNotes === 0) {
    console.log('\n⚠️  WARNING: No high-quality notes found!');
    console.log('The FHIR data appears to contain only template/placeholder content.');
    console.log('Consider using different FHIR data with real clinical information.');
  }
}

if (require.main === module) {
  main();
}