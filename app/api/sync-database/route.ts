import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Configuration
const NOTE_TEXT_DIR = path.join(process.cwd(), 'note_text');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'check-missing') {
      return await checkMissingDatabaseEntries();
    } else if (action === 'status') {
      return await getDatabaseSyncStatus();
    }

    return NextResponse.json({
      error: 'Invalid action. Supported actions: check-missing, status'
    }, { status: 400 });
  } catch (error) {
    console.error('Database Sync API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === 'sync-missing') {
      return await syncMissingDatabaseEntries();
    }

    return NextResponse.json({
      error: 'Invalid action. Supported actions: sync-missing'
    }, { status: 400 });
  } catch (error) {
    console.error('Database Sync POST API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}

/**
 * Parse note text file and extract note IDs
 */
function parseNoteFileForIds(filePath: string): string[] {
  try {
    const content = require('fs').readFileSync(filePath, 'utf8');
    const noteIds: string[] = [];

    // Extract note IDs using regex
    const noteIdMatches = content.matchAll(/Note ID: ([^\n\r]+)/g);
    for (const match of noteIdMatches) {
      noteIds.push(match[1].trim());
    }

    return noteIds;
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return [];
  }
}

/**
 * Check for note files that don't have corresponding database entries
 */
async function checkMissingDatabaseEntries() {
  try {
    // Ensure note_text directory exists
    try {
      await fs.access(NOTE_TEXT_DIR, fs.constants.R_OK);
    } catch (error) {
      return NextResponse.json({
        error: 'note_text directory not found or not accessible'
      }, { status: 404 });
    }

    // Get all note text files
    const files = await fs.readdir(NOTE_TEXT_DIR);
    const noteTextFiles = files.filter(file => file.endsWith('_extracted_notes.txt'));

    // Get all existing note IDs from database
    const { data: existingNotes, error } = await supabase
      .from('clinical_notes_embeddings')
      .select('note_id, source_file');

    if (error) {
      console.error('Error fetching existing notes:', error);
      return NextResponse.json({
        error: 'Failed to fetch existing notes from database'
      }, { status: 500 });
    }

    const existingNoteIds = new Set(existingNotes?.map(note => note.note_id) || []);
    const existingFiles = new Set(existingNotes?.map(note => note.source_file) || []);

    // Analyze each file
    const fileAnalysis: any[] = [];
    const missingNoteIds: string[] = [];

    for (const file of noteTextFiles) {
      const filePath = path.join(NOTE_TEXT_DIR, file);
      const noteIds = parseNoteFileForIds(filePath);

      const missingInFile = noteIds.filter(id => !existingNoteIds.has(id));
      const presentInFile = noteIds.filter(id => existingNoteIds.has(id));

      fileAnalysis.push({
        fileName: file,
        totalNotes: noteIds.length,
        notesInDatabase: presentInFile.length,
        notesMissing: missingInFile.length,
        missingNoteIds: missingInFile
      });

      missingNoteIds.push(...missingInFile);
    }

    // Find files with no database entries
    const filesMissingInDb = noteTextFiles.filter(file => !existingFiles.has(file));

    return NextResponse.json({
      success: true,
      summary: {
        totalNoteFiles: noteTextFiles.length,
        filesWithDatabaseEntries: noteTextFiles.length - filesMissingInDb.length,
        filesMissingInDb: filesMissingInDb.length,
        totalNoteIdsFound: fileAnalysis.reduce((sum, file) => sum + file.totalNotes, 0),
        totalNotesInDatabase: existingNotes?.length || 0,
        totalNotesMissing: missingNoteIds.length
      },
      fileAnalysis,
      filesMissingInDb,
      missingNoteIds
    });

  } catch (error) {
    console.error('Error checking missing database entries:', error);
    return NextResponse.json({
      error: 'Failed to check missing database entries'
    }, { status: 500 });
  }
}

/**
 * Get database sync status
 */
async function getDatabaseSyncStatus() {
  try {
    const checkResponse = await checkMissingDatabaseEntries();

    if (!checkResponse.ok) {
      const errorData = await checkResponse.json();
      return NextResponse.json({
        success: false,
        error: errorData.error || 'Failed to check database sync status',
        status: {
          lastChecked: new Date().toISOString(),
          totalNoteFiles: 0,
          filesWithDatabaseEntries: 0,
          totalNotesInDatabase: 0,
          totalNotesMissing: 0,
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
        isFullySynced: data.summary?.totalNotesMissing === 0
      }
    });

  } catch (error) {
    console.error('Error getting database sync status:', error);
    return NextResponse.json({
      error: 'Failed to get database sync status'
    }, { status: 500 });
  }
}

/**
 * Sync missing database entries (placeholder for now)
 */
async function syncMissingDatabaseEntries() {
  try {
    const checkResponse = await checkMissingDatabaseEntries();
    const data = await checkResponse.json();

    if (!data.success) {
      return NextResponse.json(data);
    }

    if (data.missingNoteIds.length === 0 && data.filesMissingInDb.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All notes are already synced with database',
        processedNotes: 0,
        processedFiles: 0
      });
    }

    // For now, return a message indicating manual processing is needed
    // TODO: Implement actual RAG processing with working embeddings
    return NextResponse.json({
      success: false,
      message: 'RAG processing currently disabled - Z.ai embeddings API not available',
      totalNotesMissing: data.missingNoteIds.length,
      filesMissingInDb: data.filesMissingInDb.length,
      note: 'Please enable embeddings API or process manually',
      missingNoteIds: data.missingNoteIds.slice(0, 10), // Show first 10 as example
      filesMissingInDbList: data.filesMissingInDb
    });

  } catch (error) {
    console.error('Error syncing missing database entries:', error);
    return NextResponse.json({
      error: 'Failed to sync missing database entries'
    }, { status: 500 });
  }
}