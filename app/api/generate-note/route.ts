import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

export async function POST() {
  try {
    // Read FHIR files from the directory
    const fhirDir = join(process.cwd(), "fhir-data");
    const files = await readdir(fhirDir);

    // Filter for JSON files
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    if (jsonFiles.length === 0) {
      return NextResponse.json({ error: "No FHIR JSON files found" }, { status: 404 });
    }

    // Read all JSON files and extract patient information
    const fhirFiles = [];

    for (const fileName of jsonFiles) {
      try {
        const fhirFilePath = join(fhirDir, fileName);
        const fhirData = await readFile(fhirFilePath, 'utf-8');
        const parsedFhirData = JSON.parse(fhirData);

        if (parsedFhirData.resourceType) {
          // Extract patient information for display
          let patientInfo = { name: fileName, id: fileName };

          if (parsedFhirData.resourceType === 'Bundle' && parsedFhirData.entry) {
            const resources = parsedFhirData.entry.map((entry: any) => entry.resource);
            const patient = resources.find((r: any) => r.resourceType === 'Patient');

            if (patient && patient.name) {
              const name = patient.name[0];
              patientInfo = {
                name: `${name.given?.[0] || ''} ${name.family || ''}`.trim() || fileName,
                id: fileName,
                birthDate: patient.birthDate,
                gender: patient.gender
              };
            }
          }

          fhirFiles.push({
            fileName,
            patientInfo,
            fhirData: parsedFhirData
          });
        }
      } catch (error) {
        console.error(`Error reading file ${fileName}:`, error);
        // Skip invalid files but continue processing others
      }
    }

    return NextResponse.json({
      fhirFiles,
      count: fhirFiles.length
    });

  } catch (error) {
    console.error("Error reading FHIR files:", error);
    return NextResponse.json({ error: "Failed to read FHIR data" }, { status: 500 });
  }
}
