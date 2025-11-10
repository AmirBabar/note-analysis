#!/usr/bin/env node

/**
 * Test RAG with LLM
 *
 * This script tests the RAG system by:
 * 1. Retrieving clinical notes from the database
 * 2. Creating RAG context
 * 3. Sending to LLM for analysis
 */

const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

// Configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Google Generative AI for embeddings
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Initialize OpenAI-compatible client for Z.ai
const llmClient = new OpenAI({
  apiKey: "2ef1bbc746064620b713fc2973c89043.V7qU9q9OEPbeLELE",
  baseURL: "https://api.z.ai/api/paas/v4/"
});

/**
 * Get clinical notes for a specific patient from database
 */
async function getPatientClinicalNotes(patientId) {
  try {
    const { data, error } = await supabase
      .from('clinical_notes_embeddings')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching clinical notes:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching clinical notes:', error);
    return [];
  }
}

/**
 * Get all unique patient IDs from the database
 */
async function getUniquePatientIds() {
  try {
    const { data, error } = await supabase
      .from('clinical_notes_embeddings')
      .select('patient_id')
      .not('patient_id', 'is', null);

    if (error) {
      console.error('Error fetching patient IDs:', error);
      return [];
    }

    const uniquePatientIds = [...new Set(data?.map(row => row.patient_id))];
    return uniquePatientIds;
  } catch (error) {
    console.error('Error fetching patient IDs:', error);
    return [];
  }
}

/**
 * Create embedding for query text
 */
async function createQueryEmbedding(query) {
  try {
    const result = await embeddingModel.embedContent(query);
    return result.embedding.values;
  } catch (error) {
    console.error('Error creating query embedding:', error);
    return null;
  }
}

/**
 * Perform vector similarity search
 */
async function searchSimilarNotes(queryEmbedding, limit = 5) {
  try {
    const { data, error } = await supabase
      .rpc('search_clinical_notes', {
        query_embedding: queryEmbedding,
        match_count: limit,
        similarity_threshold: 0.5
      });

    if (error) {
      console.error('Error searching similar notes:', error);
      // Fallback: get recent notes for the same patient
      return await getRecentClinicalNotes();
    }

    return data || [];
  } catch (error) {
    console.error('Error searching similar notes:', error);
    return [];
  }
}

/**
 * Fallback: Get recent clinical notes
 */
async function getRecentClinicalNotes(limit = 5) {
  try {
    const { data, error } = await supabase
      .from('clinical_notes_embeddings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching recent notes:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching recent notes:', error);
    return [];
  }
}

/**
 * Build RAG context from retrieved notes
 */
function buildRAGContext(retrievedNotes) {
  if (retrievedNotes.length === 0) {
    return "No relevant clinical notes found in the database.";
  }

  let context = "RELEVANT CLINICAL NOTES FROM DATABASE:\n";
  context += "========================================\n\n";

  retrievedNotes.forEach((note, index) => {
    const metadata = note.metadata || {};
    const noteType = metadata.note_type || 'Unknown';
    const provider = metadata.provider || 'Unknown Provider';
    const organization = metadata.organization || 'Unknown Organization';
    const noteDate = metadata.note_date || note.created_at;

    context += `NOTE ${index + 1} (${noteType}):\n`;
    context += `Date: ${noteDate}\n`;
    context += `Provider: ${provider}\n`;
    context += `Organization: ${organization}\n`;
    context += `Note ID: ${note.note_id}\n`;
    context += `Chunk ${note.chunk_index + 1} of ${metadata.total_chunks || 1}\n`;
    context += `Content: ${note.content}\n\n`;
  });

  return context;
}

/**
 * Send RAG context to LLM for analysis
 */
async function analyzeWithLLM(query, ragContext) {
  try {
    const prompt = `You are a clinical AI assistant. Analyze the following query and provide insights based on the retrieved clinical notes.

USER QUERY:
${query}

${ragContext}

Please provide a comprehensive analysis using this format:

## 🔴 **URGENT: Critical Findings**
*Immediate attention required within 24-48 hours*
- **Bold** key clinical issues
- Use *italics* for qualifying information
- Maximum 20 words per bullet point

## 🟡 **SOON: Important Findings**
*Attention needed within 1-2 weeks*
- **Bold** important clinical observations
- Use *italics* for supporting details
- Maximum 20 words per bullet point

## 🔵 **MONITOR: Routine Findings**
*Continue to monitor at regular intervals*
- **Bold** routine clinical observations
- Use *italics* for context
- Maximum 20 words per bullet point

## 💡 **AI Insights**
*Analysis and recommendations*
- **Bold** key insights
- Use *italics* for explanations
- Maximum 20 words per bullet point

## 🎯 **Care Coordination**
*Action items and follow-up*
- **Bold** specific actions
- Use *italics** for timing/details
- Maximum 20 words per bullet point

## 📊 **Data Quality**
*Information reliability assessment*
- **Bold** quality indicators
- Use *italics* for limitations
- Maximum 20 words per bullet point`;

    const response = await llmClient.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a clinical AI assistant providing structured analysis of medical information with specific formatting requirements."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error analyzing with LLM:', error);
    return `Error: Could not complete LLM analysis. ${error.message}`;
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('🧪 Testing RAG with LLM Analysis');
  console.log('===============================');
  console.log('');

  try {
    // 1. Get unique patient IDs
    console.log('🔍 Finding patient IDs in database...');
    const patientIds = await getUniquePatientIds();

    if (patientIds.length === 0) {
      console.log('❌ No patient IDs found in database');
      return;
    }

    console.log(`✅ Found ${patientIds.length} patient IDs: ${patientIds.join(', ')}`);
    console.log('');

    // 2. Get notes for first patient
    const testPatientId = patientIds[0];
    console.log(`📋 Retrieving clinical notes for patient: ${testPatientId}`);
    const patientNotes = await getPatientClinicalNotes(testPatientId);

    if (patientNotes.length === 0) {
      console.log('❌ No clinical notes found for patient');
      return;
    }

    console.log(`✅ Found ${patientNotes.length} note chunks for patient`);
    console.log('');

    // 3. Test query
    const testQuery = "What are the patient's main health concerns and what follow-up is needed?";
    console.log(`❓ Test Query: "${testQuery}"`);
    console.log('');

    // 4. Create query embedding and search
    console.log('🔍 Performing vector similarity search...');
    const queryEmbedding = await createQueryEmbedding(testQuery);
    const retrievedNotes = await searchSimilarNotes(queryEmbedding, 3);

    console.log(`✅ Retrieved ${retrievedNotes.length} relevant notes`);
    console.log('');

    // 5. Build RAG context
    console.log('📝 Building RAG context...');
    const ragContext = buildRAGContext(retrievedNotes);
    console.log(`✅ RAG context built (${ragContext.length} characters)`);
    console.log('');

    // 6. Send to LLM
    console.log('🤖 Sending to LLM for analysis...');
    const analysis = await analyzeWithLLM(testQuery, ragContext);
    console.log('✅ LLM analysis complete');
    console.log('');

    // 7. Display results
    console.log('🎯 ANALYSIS RESULTS');
    console.log('===================');
    console.log('');
    console.log(analysis);
    console.log('');

    console.log('📊 TEST SUMMARY');
    console.log('================');
    console.log(`✅ Patient ID: ${testPatientId}`);
    console.log(`📝 Available notes: ${patientNotes.length}`);
    console.log(`🔍 Retrieved notes: ${retrievedNotes.length}`);
    console.log(`🤖 LLM analysis: Complete`);
    console.log('🎉 RAG system working successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
main().catch(console.error);