import { FHIRBundle, FHIRResource } from '@/types/fhir';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ClinicalNote {
  id: string;
  patientId: string;
  date: string;
  doctor: string;
  organization: string;
  content: string;
  fileName: string;
  noteType: string;
}

export async function saveNotesToFile(notes: ClinicalNote[], sourceFileName: string): Promise<string> {
  if (notes.length === 0) {
    console.log('No notes to save');
    return '';
  }

  try {
    // Create note_text directory if it doesn't exist
    const noteTextDir = join(process.cwd(), 'note_text');
    mkdirSync(noteTextDir, { recursive: true });

    // Generate output filename based on source filename
    const baseName = sourceFileName.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const outputFileName = `${baseName}_${timestamp}_extracted_notes.txt`;
    const outputPath = join(noteTextDir, outputFileName);

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
    writeFileSync(outputPath, fileContent, 'utf8');

    console.log(`✅ Saved ${notes.length} clinical notes to: ${outputFileName}`);
    return outputFileName;

  } catch (error) {
    console.error('❌ Error saving notes to file:', error);
    throw error;
  }
}

export function extractClinicalNotesFromFHIR(bundle: FHIRBundle, fileName: string): ClinicalNote[] {
  const notes: ClinicalNote[] = [];

  if (!bundle.entry) return notes;

  bundle.entry.forEach(entry => {
    const resource = entry.resource;

    // Extract from DocumentReference resources
    if (resource.resourceType === 'DocumentReference') {
      try {
        const docRef = resource as any;

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
        const noteType = docRef.type?.coding?.[0]?.display || docRef.type?.text || 'Clinical Note';

        if (content.trim()) {
          notes.push({
            id: docRef.id || `note-${notes.length}`,
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
        console.warn('Error processing DocumentReference:', error);
      }
    }

    // Extract from DiagnosticReport resources
    if (resource.resourceType === 'DiagnosticReport') {
      try {
        const report = resource as any;

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
          const results = report.result.map((result: any) => {
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
            id: report.id || `report-${notes.length}`,
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
        console.warn('Error processing DiagnosticReport:', error);
      }
    }
  });

  return notes;
}

export function chunkNote(note: ClinicalNote, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const content = note.content;

  if (content.length <= maxChunkSize) {
    chunks.push(content);
    return chunks;
  }

  // Split by paragraphs first
  const paragraphs = content.split(/\n\s*\n/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + '\n\n' + paragraph).length <= maxChunkSize) {
      if (currentChunk) {
        currentChunk += '\n\n' + paragraph;
      } else {
        currentChunk = paragraph;
      }
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      // If single paragraph is too long, split by sentences
      if (paragraph.length > maxChunkSize) {
        const sentences = paragraph.split('. ');
        let sentenceChunk = '';

        for (const sentence of sentences) {
          if ((sentenceChunk + '. ' + sentence).length <= maxChunkSize) {
            if (sentenceChunk) {
              sentenceChunk += '. ' + sentence;
            } else {
              sentenceChunk = sentence;
            }
          } else {
            if (sentenceChunk) {
              chunks.push(sentenceChunk.trim() + '.');
            }
            sentenceChunk = sentence;
          }
        }

        if (sentenceChunk) {
          currentChunk = sentenceChunk.trim() + '.';
        } else {
          currentChunk = '';
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}