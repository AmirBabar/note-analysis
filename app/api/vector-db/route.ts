import { NextRequest, NextResponse } from 'next/server';
import supabaseVectorDB from '@/lib/supabase-vector';
import { extractClinicalNotesFromFHIR, chunkNote, saveNotesToFile } from '@/lib/fhir-extraction';
import { FHIRBundle } from '@/types/fhir';

export async function POST(request: NextRequest) {
  try {
    const { action, data } = await request.json();

    switch (action) {
      case 'initialize':
        await supabaseVectorDB.initializeDatabase();
        return NextResponse.json({
          success: true,
          message: 'Vector database initialized successfully'
        });

      case 'extract-and-store':
        const { fhirData, fileName, patientId } = data;

        if (!fhirData || !fileName || !patientId) {
          return NextResponse.json({
            error: 'Missing required parameters: fhirData, fileName, patientId'
          }, { status: 400 });
        }

        // Extract clinical notes from FHIR data
        const notes = extractClinicalNotesFromFHIR(fhirData, fileName);

        if (notes.length === 0) {
          return NextResponse.json({
            success: true,
            message: 'No clinical notes found in FHIR data',
            notesProcessed: 0
          });
        }

        // Save extracted notes to file for validation
        let savedNotesFile = '';
        try {
          savedNotesFile = await saveNotesToFile(notes, fileName);
        } catch (fileError) {
          console.warn('Error saving notes to file:', fileError);
          // Continue with processing even if file saving fails
        }

        // Process each note
        let totalChunks = 0;
        for (const note of notes) {
          const chunks = chunkNote(note);
          await supabaseVectorDB.storeNoteEmbeddings(note, chunks);
          totalChunks += chunks.length;
        }

        return NextResponse.json({
          success: true,
          message: `Successfully processed ${notes.length} notes with ${totalChunks} total chunks`,
          notesProcessed: notes.length,
          totalChunks,
          notes: notes.map(n => ({
            id: n.id,
            date: n.date,
            doctor: n.doctor,
            noteType: n.noteType,
            contentLength: n.content.length
          })),
          savedNotesFile: savedNotesFile ? `note_text/${savedNotesFile.split('/').pop()}` : null
        });

      case 'search':
        const { query, patientId: searchPatientId, limit = 5, threshold = 0.7 } = data;

        if (!query) {
          return NextResponse.json({
            error: 'Missing search query'
          }, { status: 400 });
        }

        const results = await supabaseVectorDB.searchSimilarNotes(
          query,
          searchPatientId,
          limit,
          threshold
        );

        return NextResponse.json({
          success: true,
          results,
          count: results.length
        });

      case 'get-patient-notes':
        const { patientId: queryPatientId, limit: notesLimit = 50 } = data;

        if (!queryPatientId) {
          return NextResponse.json({
            error: 'Missing patient ID'
          }, { status: 400 });
        }

        const patientNotes = await supabaseVectorDB.getPatientNotes(
          queryPatientId,
          notesLimit
        );

        return NextResponse.json({
          success: true,
          notes: patientNotes,
          count: patientNotes.length
        });

      case 'stats':
        const stats = await supabaseVectorDB.getDatabaseStats();
        return NextResponse.json({
          success: true,
          stats
        });

      case 'delete-note':
        const { noteId } = data;

        if (!noteId) {
          return NextResponse.json({
            error: 'Missing note ID'
          }, { status: 400 });
        }

        await supabaseVectorDB.deleteNoteEmbeddings(noteId);

        return NextResponse.json({
          success: true,
          message: `Note embeddings deleted for note ID: ${noteId}`
        });

      default:
        return NextResponse.json({
          error: 'Invalid action. Supported actions: initialize, extract-and-store, search, get-patient-notes, stats, delete-note'
        }, { status: 400 });
    }
  } catch (error) {
    console.error('Vector DB API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'stats') {
      const stats = await supabaseVectorDB.getDatabaseStats();
      return NextResponse.json({ success: true, stats });
    }

    const patientId = searchParams.get('patientId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (action === 'patient-notes' && patientId) {
      const notes = await supabaseVectorDB.getPatientNotes(patientId, limit);
      return NextResponse.json({
        success: true,
        notes,
        count: notes.length
      });
    }

    const query = searchParams.get('query');
    const searchLimit = parseInt(searchParams.get('limit') || '5');
    const threshold = parseFloat(searchParams.get('threshold') || '0.7');

    if (action === 'search' && query) {
      const results = await supabaseVectorDB.searchSimilarNotes(
        query,
        patientId || undefined,
        searchLimit,
        threshold
      );
      return NextResponse.json({
        success: true,
        results,
        count: results.length
      });
    }

    return NextResponse.json({
      error: 'Invalid or missing action parameter. Supported actions: stats, search, patient-notes'
    }, { status: 400 });
  } catch (error) {
    console.error('Vector DB GET API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}