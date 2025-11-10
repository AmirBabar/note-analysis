import OpenAI from "openai";
import { NextResponse } from "next/server";
import supabaseVectorDB from '@/lib/supabase-vector';
import { extractClinicalNotesFromFHIR, chunkNote, saveNotesToFile } from '@/lib/fhir-extraction';

// Configure Z.ai API with OpenAI SDK compatibility
const client = new OpenAI({
  apiKey: "2ef1bbc746064620b713fc2973c89043.V7qU9q9OEPbeLELE",
  baseURL: "https://api.z.ai/api/paas/v4/"
});

export async function POST(request: Request) {
  try {
    const { fhirData, fileName, useRAG = true } = await request.json();

    console.log('🔍 DEBUG: Received request data:', {
      hasFhirData: !!fhirData,
      fileName: typeof fileName === 'string' ? fileName : typeof fileName,
      fileNameValue: fileName,
      useRAG,
      fhirType: fhirData?.resourceType,
      hasEntries: !!fhirData?.entry,
      entryCount: fhirData?.entry?.length,
      fhirDataKeys: Object.keys(fhirData || {})
    });

    if (!fhirData) {
      return NextResponse.json({ error: "FHIR data is required" }, { status: 400 });
    }

    // Extract patient ID from FHIR data
    let patientId = 'unknown';
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const patient = fhirData.entry.find((entry: any) => entry.resource.resourceType === 'Patient')?.resource;
      if (patient && patient.id) {
        patientId = patient.id;
      }
      console.log('🔍 DEBUG: Extracted patient ID:', patientId);
    }

    // Extract clinical summary
    let clinicalSummary = extractClinicalSummary(fhirData);
    console.log('🔍 DEBUG: Clinical summary length:', clinicalSummary.length);
    console.log('🔍 DEBUG: Clinical summary preview:', clinicalSummary.substring(0, 200));

    // Initialize RAG context
    let ragContext = '';
    let vectorSearchResults: any[] = [];
    let savedNotesFile = '';

    if (useRAG) {
      try {
        console.log('🔍 DEBUG: Starting RAG processing for patient:', patientId);

        // For now, skip the embedding search and get patient notes directly
        console.log('🔍 DEBUG: Getting patient notes directly from database...');
        const patientNotes = await supabaseVectorDB.getPatientNotes(patientId, 10);
        console.log('🔍 DEBUG: Retrieved', patientNotes.length, 'patient notes directly');

        if (patientNotes.length > 0) {
          console.log('🔍 DEBUG: Building RAG context from direct patient notes');
          ragContext = '\n\n--- Relevant Clinical Context from Patient Notes ---\n';
          patientNotes.forEach((note, index) => {
            const metadata = note.metadata || {};
            ragContext += `\n${index + 1}. ${metadata.note_type || 'Clinical Note'} (${metadata.date || note.created_at})\n`;
            ragContext += `   Provider: ${(metadata as any).provider || metadata.doctor || 'Unknown'}\n`;
            ragContext += `   Content: ${note.content.substring(0, 500)}${note.content.length > 500 ? '...' : ''}\n`;
          });
          ragContext += '--- End Context ---\n\n';
          console.log('🔍 DEBUG: RAG context built from direct notes, length:', ragContext.length);
          vectorSearchResults = patientNotes;
        } else {
          console.log('🔍 DEBUG: No patient notes found - database might be empty or patient ID mismatch');

          // Try to see what patient IDs are available
          try {
            const stats = await supabaseVectorDB.getDatabaseStats();
            console.log('🔍 DEBUG: Database stats:', stats);
            if (stats.totalEmbeddings > 0) {
              console.log('🔍 DEBUG: Available patient IDs:', [...new Set(stats.recentNotes?.map((item: any) => item.patient_id))]);
            }
          } catch (statsError) {
            console.error('🔍 DEBUG: Error getting database stats:', statsError);
          }
        }
      } catch (ragError) {
        console.error('❌ RAG processing failed:', ragError);
        // Continue without RAG context
      }
    }

    // Truncate clinical summary if too long
    const truncatedSummary = clinicalSummary.length > 2000
      ? clinicalSummary.substring(0, 2000) + "...(truncated)"
      : clinicalSummary;

    // Prepare the enhanced RAG prompt
    const prompt = `Analyze the following clinical information extracted from FHIR data and provide comprehensive clinical insights with RAG-enhanced context:

File: ${fileName}
Patient ID: ${patientId}

Current Clinical Information:
${truncatedSummary}

${ragContext}

Please provide a comprehensive clinical analysis using the following format with specific requirements:

## 🔴 **URGENT: Critical Findings**
*Immediate attention required within 24-48 hours*
- **Bold** key clinical issues
- Use *italics* for qualifying information
- Maximum 20 words per bullet point

## 🟡 **SOON: Important Considerations**
*Action needed within 1-4 weeks*
- **Bold** significant concerns
- Use *italics* for supporting details
- Maximum 20 words per bullet point

## 🔵 **MONITOR: Ongoing Management**
*Routine follow-up and preventive care*
- **Bold** key monitoring points
- Use *italics* for prevention strategies
- Maximum 20 words per bullet point

## 💡 **AI Insights Summary**
*Enhanced analysis using RAG context*
- **Bold** critical patterns
- Use *italics* for contextual relevance
- Maximum 20 words per bullet point

## 🎯 **Care Coordination Recommendations**
*Team-based care optimization*
- **Bold** coordination priorities
- Use *italics* for team roles
- Maximum 20 words per bullet point

## 📊 **Data Quality Assessment**
*Clinical information completeness*
- **Bold** data limitations
- Use *italics* for confidence levels
- Maximum 20 words per bullet point

Format your response clearly with markdown headers. Use the exact emoji indicators (🔴, 🟡, 🔵, 💡, 🎯, 📊) as shown. Each bullet point must be under 20 words and use bold/italic formatting as specified.`;

    // Use Z.ai API with OpenAI SDK
    const completion = await client.chat.completions.create({
      model: "glm-4-32b-0414-128k",
      messages: [
        {
          role: "system",
          content: "You are a helpful medical AI assistant specializing in FHIR data analysis with RAG-enhanced clinical insights. Always use the specified emoji indicators and formatting requirements."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.3
    });

    const analysis = completion.choices[0]?.message?.content || "No analysis available";

    return NextResponse.json({
      analysis,
      clinicalSummary,
      ragContext: ragContext ? 'RAG context included' : 'No RAG context available',
      vectorSearchResults: vectorSearchResults.length,
      fileName,
      patientId,
      savedNotesFile: savedNotesFile ? `note_text/${savedNotesFile.split('/').pop()}` : null
    });

  } catch (error) {
    console.error("Error analyzing FHIR data:", error);
    return NextResponse.json({ error: "Failed to analyze FHIR data" }, { status: 500 });
  }
}

function extractClinicalSummary(fhirData: any): string {
  let summary = "";

  try {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);

      // Extract patient information
      const patient = resources.find((r: any) => r.resourceType === 'Patient');
      if (patient) {
        const name = patient.name?.[0];
        summary += `Patient: ${name?.given?.[0] || ''} ${name?.family || ''}\n`;
        summary += `Gender: ${patient.gender || 'Unknown'}\n`;
        summary += `Birth Date: ${patient.birthDate || 'Unknown'}\n\n`;
      }

      // Extract conditions
      const conditions = resources.filter((r: any) => r.resourceType === 'Condition');
      if (conditions.length > 0) {
        summary += "Conditions:\n";
        conditions.forEach((condition: any) => {
          const code = condition.code?.coding?.[0];
          summary += `- ${code?.display || code?.code || 'Unknown condition'}\n`;
        });
        summary += "\n";
      }

      // Extract observations
      const observations = resources.filter((r: any) => r.resourceType === 'Observation');
      if (observations.length > 0) {
        summary += "Recent Observations:\n";
        observations.slice(0, 10).forEach((obs: any) => {
          const code = obs.code?.coding?.[0];
          const value = obs.valueQuantity;
          summary += `- ${code?.display || code?.code || 'Unknown observation'}: ${value?.value || 'N/A'} ${value?.unit || ''}\n`;
        });
      }

      // Extract encounters
      const encounters = resources.filter((r: any) => r.resourceType === 'Encounter');
      if (encounters.length > 0) {
        summary += `\nEncounters: ${encounters.length} found\n`;
      }
    } else {
      summary = "FHIR data format not recognized or empty";
    }
  } catch (error) {
    summary = "Error extracting clinical summary from FHIR data";
  }

  return summary;
}
