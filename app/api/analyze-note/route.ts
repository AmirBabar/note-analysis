import OpenAI from "openai";
import { NextResponse } from "next/server";

// Configure Z.ai API with OpenAI SDK compatibility
const client = new OpenAI({
  apiKey: "2ef1bbc746064620b713fc2973c89043.V7qU9q9OEPbeLELE",
  baseURL: "https://api.z.ai/api/paas/v4/"
});

export async function POST(request: Request) {
  try {
    const { fhirData, fileName } = await request.json();

    if (!fhirData) {
      return NextResponse.json({ error: "FHIR data is required" }, { status: 400 });
    }

    // Extract relevant information from FHIR data
    let clinicalSummary = extractClinicalSummary(fhirData);

    // Truncate clinical summary if too long (keep it under 2000 characters)
    const truncatedSummary = clinicalSummary.length > 2000
      ? clinicalSummary.substring(0, 2000) + "...(truncated)"
      : clinicalSummary;

    // Prepare the prompt for Z.ai API using only clinical summary
    const prompt = `Analyze the following clinical information extracted from FHIR data and provide a comprehensive clinical assessment:

File: ${fileName}

Clinical Information:
${truncatedSummary}

Please provide a detailed analysis with the following sections:

## Key Clinical Findings
Summarize the most important clinical findings, diagnoses, and health status indicators. Highlight any acute or chronic conditions that require attention.

## Risk Assessment
Identify potential health risks, medication interactions, or clinical concerns based on the available data. Flag any abnormal values or uncontrolled conditions.

## Clinical Goals & Objectives
Based on the patient's conditions and data, suggest specific, measurable care goals. Include targets for blood pressure, glucose control, weight management, or other relevant health metrics.

## Recommended Actions
Provide specific clinical recommendations, including:
- Medication adjustments or monitoring needs
- Lifestyle interventions
- Follow-up scheduling
- Additional screenings or tests needed
- Specialist referrals if indicated

## Care Coordination Insights
Identify any gaps in care, potential coordination opportunities, or areas where the care team should focus attention.

## Data Quality Notes
Briefly comment on the completeness and quality of the available clinical information.

Format your response clearly with markdown headers for each section. Be specific and actionable in your recommendations.`;

    // Use Z.ai API with OpenAI SDK
    const completion = await client.chat.completions.create({
      model: "glm-4-32b-0414-128k",
      messages: [
        {
          role: "system",
          content: "You are a helpful medical AI assistant specializing in FHIR data analysis."
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
      fileName
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
