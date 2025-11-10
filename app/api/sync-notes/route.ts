import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { processFHIRFile } from '@/lib/note-extraction';

const FHIR_DATA_DIR = path.join(process.cwd(), 'fhir-data');
const NOTE_TEXT_DIR = path.join(process.cwd(), 'note_text');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'check-missing') {
      return await checkMissingFiles();
    } else if (action === 'sync-all') {
      return await syncAllFiles();
    } else if (action === 'status') {
      return await getSyncStatus();
    }

    return NextResponse.json({
      error: 'Invalid action. Supported actions: check-missing, sync-all, status'
    }, { status: 400 });
  } catch (error) {
    console.error('Sync API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === 'sync-missing') {
      return await syncMissingFiles();
    }

    return NextResponse.json({
      error: 'Invalid action. Supported actions: sync-missing'
    }, { status: 400 });
  } catch (error) {
    console.error('Sync POST API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}

/**
 * Check for FHIR files that don't have corresponding note text files
 */
async function checkMissingFiles() {
  try {
    // Check if fhir-data directory exists and is readable
    try {
      await fs.access(FHIR_DATA_DIR, fs.constants.R_OK);
    } catch (error) {
      return NextResponse.json({
        error: 'fhir-data directory not found or not accessible'
      }, { status: 404 });
    }

    // Ensure note_text directory exists
    try {
      await fs.access(NOTE_TEXT_DIR, fs.constants.R_OK);
    } catch (error) {
      await fs.mkdir(NOTE_TEXT_DIR, { recursive: true });
    }

    // Get all FHIR files
    const fhirFiles = await fs.readdir(FHIR_DATA_DIR);
    const fhirJsonFiles = fhirFiles.filter(file => file.endsWith('.json'));

    // Get all existing note text files
    let noteTextFiles: string[] = [];
    try {
      noteTextFiles = await fs.readdir(NOTE_TEXT_DIR);
    } catch (error) {
      // Directory doesn't exist or is empty
    }

    // Filter only extracted notes files
    const extractedNotesFiles = noteTextFiles.filter(file => file.includes('_extracted_notes.txt'));

    // Find missing files
    const missingFiles = [];
    const existingFiles = [];

    for (const fhirFile of fhirJsonFiles) {
      const expectedNoteFile = fhirFile.replace(/\.json$/i, '_extracted_notes.txt');

      if (extractedNotesFiles.includes(expectedNoteFile)) {
        existingFiles.push(fhirFile);
      } else {
        missingFiles.push(fhirFile);
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalFhirFiles: fhirJsonFiles.length,
        existingNoteFiles: existingFiles.length,
        missingFiles: missingFiles.length
      },
      existingFiles,
      missingFiles
    });

  } catch (error) {
    console.error('Error checking missing files:', error);
    return NextResponse.json({
      error: 'Failed to check missing files'
    }, { status: 500 });
  }
}

/**
 * Get sync status
 */
async function getSyncStatus() {
  try {
    const checkResponse = await checkMissingFiles();

    if (!checkResponse.ok) {
      const errorData = await checkResponse.json();
      return NextResponse.json({
        success: false,
        error: errorData.error || 'Failed to check sync status',
        status: {
          lastChecked: new Date().toISOString(),
          totalFhirFiles: 0,
          existingNoteFiles: 0,
          missingFiles: 0,
          isFullySynced: false
        }
      }, { status: 500 });
    }

    const data = await checkResponse.json();

    return NextResponse.json({
      success: true,
      status: {
        lastChecked: new Date().toISOString(),
        ...data.summary,
        isFullySynced: data.summary?.missingFiles === 0
      }
    });

  } catch (error) {
    console.error('Error getting sync status:', error);
    return NextResponse.json({
      error: 'Failed to get sync status'
    }, { status: 500 });
  }
}

/**
 * Sync missing files
 */
async function syncMissingFiles() {
  try {
    // First check what's missing
    const checkResponse = await checkMissingFiles();
    const data = await checkResponse.json();

    if (!data.success) {
      return NextResponse.json(data);
    }

    if (data.missingFiles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All files are already synced',
        processedFiles: 0,
        totalNotesExtracted: 0
      });
    }

    // Process missing files
    const results = [];
    let totalNotesExtracted = 0;

    for (const fhirFile of data.missingFiles) {
      const filePath = path.join(FHIR_DATA_DIR, fhirFile);
      console.log(`🔄 Syncing missing file: ${fhirFile}`);

      try {
        const result = await processFHIRFile(filePath, NOTE_TEXT_DIR);
        results.push(result);
        totalNotesExtracted += result.notesExtracted;
      } catch (error) {
        console.error(`❌ Error syncing ${fhirFile}:`, error);
        results.push({
          fileName: fhirFile,
          notesExtracted: 0,
          savedFile: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Count successful syncs
    const successfulSyncs = results.filter(r => r.savedFile).length;

    return NextResponse.json({
      success: true,
      message: `Synced ${successfulSyncs} of ${data.missingFiles.length} missing files`,
      processedFiles: data.missingFiles.length,
      successfulSyncs,
      totalNotesExtracted,
      results
    });

  } catch (error) {
    console.error('Error syncing missing files:', error);
    return NextResponse.json({
      error: 'Failed to sync missing files'
    }, { status: 500 });
  }
}

/**
 * Sync all files (reprocess everything)
 */
async function syncAllFiles() {
  try {
    // Get all FHIR files
    const fhirFiles = await fs.readdir(FHIR_DATA_DIR);
    const fhirJsonFiles = fhirFiles.filter(file => file.endsWith('.json'));

    if (fhirJsonFiles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No FHIR files found to sync',
        processedFiles: 0,
        totalNotesExtracted: 0
      });
    }

    // Process all files
    const results = [];
    let totalNotesExtracted = 0;

    for (const fhirFile of fhirJsonFiles) {
      const filePath = path.join(FHIR_DATA_DIR, fhirFile);
      console.log(`🔄 Processing: ${fhirFile}`);

      try {
        const result = await processFHIRFile(filePath, NOTE_TEXT_DIR);
        results.push(result);
        totalNotesExtracted += result.notesExtracted;
      } catch (error) {
        console.error(`❌ Error processing ${fhirFile}:`, error);
        results.push({
          fileName: fhirFile,
          notesExtracted: 0,
          savedFile: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Count successful processing
    const successfulProcessing = results.filter(r => r.savedFile).length;

    return NextResponse.json({
      success: true,
      message: `Processed ${successfulProcessing} of ${fhirJsonFiles.length} files`,
      processedFiles: fhirJsonFiles.length,
      successfulProcessing,
      totalNotesExtracted,
      results
    });

  } catch (error) {
    console.error('Error syncing all files:', error);
    return NextResponse.json({
      error: 'Failed to sync all files'
    }, { status: 500 });
  }
}