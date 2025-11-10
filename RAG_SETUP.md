# RAG System Implementation with Supabase pgvector

This document describes the RAG (Retrieval-Augmented Generation) system implemented for clinical note analysis using Supabase pgvector.

## Overview

The RAG system enhances AI analysis by:
- Extracting clinical notes from FHIR data
- Creating vector embeddings for semantic search
- Storing embeddings in Supabase PostgreSQL with pgvector
- Retrieving relevant context for AI analysis
- Providing enhanced insights with emoji-formatted output

## Setup Instructions

### 1. Supabase Database Setup

1. **Enable pgvector Extension**:
   - Go to your Supabase dashboard → Database → Extensions
   - Search for "vector" and enable the pgvector extension

2. **Create Database Table** (optional - auto-created by upsert):
   ```sql
   CREATE TABLE clinical_notes_embeddings (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     patient_id TEXT NOT NULL,
     note_id TEXT NOT NULL,
     chunk_index INTEGER NOT NULL,
     content TEXT NOT NULL,
     embedding vector(1536),
     metadata JSONB,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     UNIQUE(patient_id, note_id, chunk_index)
   );
   ```

3. **Environment Variables**:
   Add to your `.env.local` file:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   OPENAI_API_KEY=your-openai-api-key
   ```

### 2. API Endpoints

#### `/api/analyze-note`
Enhanced analysis endpoint with RAG support:

```javascript
POST /api/analyze-note
{
  "fhirData": { /* FHIR Bundle data */ },
  "fileName": "patient-data.json",
  "useRAG": true  // Optional, defaults to true
}
```

#### `/api/vector-db`
Vector database management endpoint:

```javascript
POST /api/vector-db
{
  "action": "initialize",           // Initialize database
  "action": "extract-and-store",    // Extract and store embeddings
  "action": "search",               // Search for similar notes
  "action": "get-patient-notes",    // Get all notes for a patient
  "action": "stats",                // Get database statistics
  "action": "delete-note"           // Delete note embeddings
}
```

### 3. Key Features

#### Clinical Note Extraction
- Extracts from DocumentReference resources
- Decodes base64-encoded clinical notes
- Supports DiagnosticReport conclusions
- Maintains metadata (date, doctor, organization)

#### Vector Embeddings
- Uses OpenAI text-embedding-ada-002 model
- Intelligent chunking for large documents
- Metadata preservation for filtering
- Fallback to mock embeddings for development

#### AI Analysis Format
The system generates analysis with specific formatting:

- 🔴 **URGENT**: Critical findings (24-48 hours)
- 🟡 **SOON**: Important considerations (1-4 weeks)
- 🔵 **MONITOR**: Ongoing management
- 💡 **AI Insights**: RAG-enhanced patterns
- 🎯 **Care Coordination**: Team recommendations
- 📊 **Data Quality**: Information assessment

Each bullet point:
- Uses **bold** for key terms
- Uses *italics* for qualifying information
- Limited to 20 words maximum

## Usage Examples

### Basic RAG Analysis
```javascript
const response = await fetch('/api/analyze-note', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fhirData: fhirBundle,
    fileName: 'patient-123.json',
    useRAG: true
  })
});

const { analysis, ragContext, vectorSearchResults } = await response.json();
```

### Vector Search
```javascript
const response = await fetch('/api/vector-db', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'search',
    query: 'diabetes management',
    patientId: 'patient-123',
    limit: 5,
    threshold: 0.7
  })
});

const { results } = await response.json();
```

### Store Clinical Notes
```javascript
const response = await fetch('/api/vector-db', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'extract-and-store',
    fhirData: fhirBundle,
    fileName: 'clinical-notes.json',
    patientId: 'patient-123'
  })
});
```

## Technical Architecture

### File Structure
```
lib/
├── fhir-extraction.ts      # Clinical note extraction from FHIR
├── supabase-vector.ts      # Vector database operations
types/
└── fhir.ts                 # TypeScript FHIR types
app/api/
├── analyze-note/route.ts   # RAG-enhanced analysis endpoint
└── vector-db/route.ts      # Vector database management
```

### Core Classes
- `SupabaseVectorDB`: Vector database operations
- `extractClinicalNotesFromFHIR()`: Note extraction
- `chunkNote()`: Intelligent text chunking

### Data Flow
1. FHIR data → Clinical note extraction
2. Notes → Chunking → Embedding creation
3. Embeddings → Supabase pgvector storage
4. Query → Embedding → Vector search
5. Retrieved context → Enhanced AI analysis

## Testing

Run the test script to verify functionality:

```bash
node test-rag.js
```

The test verifies:
- ✅ Vector database initialization
- ✅ Clinical note extraction
- ✅ RAG-enhanced analysis
- ✅ Emoji formatting compliance
- ✅ Search functionality

## Production Considerations

### Performance
- Embeddings are cached in Supabase
- Vector search uses pgvector indexing
- Batch processing for large documents
- Automatic fallback for API failures

### Security
- Patient data filtering by patient ID
- Environment variable configuration
- Error handling prevents data exposure

### Scalability
- Supports multiple patients
- Handles large clinical documents
- Efficient vector similarity search
- Database connection pooling

## Troubleshooting

### Common Issues

1. **pgvector extension not enabled**
   - Enable manually in Supabase dashboard
   - Check extension is active

2. **OpenAI API key errors**
   - Verify OPENAI_API_KEY in environment
   - Check API key permissions

3. **Supabase connection issues**
   - Verify NEXT_PUBLIC_SUPABASE_URL and KEY
   - Check network connectivity

4. **Missing emoji formatting**
   - Ensure useRAG parameter is true
   - Check prompt template in analyze-note API

### Debug Mode
Enable debug logging by checking console output in the API responses.

## Future Enhancements

- Real-time vector search as notes are added
- Advanced filtering by date ranges
- Multi-patient cross-search capabilities
- Integration with additional vector databases
- Enhanced similarity search algorithms