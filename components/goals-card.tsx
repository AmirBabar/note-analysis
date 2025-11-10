import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GoalsCardProps {
  fhirData: any;
  aiAnalysis: string;
}

export function GoalsCard({ fhirData, aiAnalysis }: GoalsCardProps) {
  const extractGoalsFromAnalysis = (analysis: string) => {
    const goals: string[] = [];

    // Look for goal-related sections in the AI analysis
    const lines = analysis.split('\n');
    let inGoalsSection = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Check if we're entering a goals section
      if (trimmedLine.toLowerCase().includes('goals') ||
          trimmedLine.toLowerCase().includes('recommendations') ||
          trimmedLine.toLowerCase().includes('objectives') ||
          trimmedLine.toLowerCase().includes('plan')) {
        inGoalsSection = true;
        continue;
      }

      // Check if we're leaving the section
      if (inGoalsSection && (
          trimmedLine.toLowerCase().includes('key findings') ||
          trimmedLine.toLowerCase().includes('documentation') ||
          trimmedLine.toLowerCase().includes('completeness') ||
          trimmedLine.toLowerCase().includes('clinical insights') ||
          trimmedLine.toLowerCase().includes('improvement'))) {
        inGoalsSection = false;
        continue;
      }

      // Extract goals from the section
      if (inGoalsSection && trimmedLine && !trimmedLine.startsWith('#')) {
        // Remove bullet points and numbers
        const cleanGoal = trimmedLine.replace(/^[\d\.\-\*\s]+/, '');
        if (cleanGoal.length > 10 && goals.length < 5) {
          goals.push(cleanGoal);
        }
      }
    }

    // If no goals found, generate some based on clinical data
    if (goals.length === 0) {
      return generateGoalsFromFHIR(fhirData);
    }

    return goals;
  };

  const generateGoalsFromFHIR = (fhirData: any) => {
    const goals: string[] = [];

    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);
      const conditions = resources.filter((r: any) => r.resourceType === 'Condition');
      const observations = resources.filter((r: any) => r.resourceType === 'Observation');

      // Check for diabetes
      const hasDiabetes = conditions.some((c: any) =>
        c.code?.coding?.[0]?.display?.toLowerCase().includes('diabetes')
      );

      // Check for hypertension
      const hasHypertension = conditions.some((c: any) =>
        c.code?.coding?.[0]?.display?.toLowerCase().includes('hypertension')
      );

      // Check blood sugar levels
      const glucoseObs = observations.find((obs: any) =>
        obs.code?.coding?.[0]?.code === '2345-7' ||
        obs.code?.text?.toLowerCase().includes('glucose')
      );

      // Check blood pressure
      const bpObs = observations.filter((obs: any) =>
        obs.code?.coding?.[0]?.code === '8480-6' || // Systolic
        obs.code?.coding?.[0]?.code === '8462-4'     // Diastolic
      );

      if (hasDiabetes) {
        goals.push('Maintain blood glucose levels within target range');
        goals.push('Regular monitoring of HbA1c levels');
        goals.push('Medication adherence for diabetes management');
      }

      if (hasHypertension) {
        goals.push('Maintain blood pressure below 130/80 mmHg');
        goals.push('Regular blood pressure monitoring');
        goals.push('Sodium intake reduction');
      }

      if (glucoseObs && glucoseObs.valueQuantity?.value > 140) {
        goals.push('Improve blood glucose control through diet and exercise');
      }

      if (bpObs.length > 0) {
        const systolic = bpObs.find((obs: any) => obs.code?.coding?.[0]?.code === '8480-6');
        if (systolic && systolic.valueQuantity?.value > 140) {
          goals.push('Blood pressure optimization through lifestyle changes');
        }
      }
    }

    // Default goals if none generated
    if (goals.length === 0) {
      goals.push('Regular health monitoring and check-ups');
      goals.push('Maintain healthy lifestyle with balanced diet');
      goals.push('Regular physical activity (150 minutes/week)');
    }

    return goals.slice(0, 4);
  };

  const goals = extractGoalsFromAnalysis(aiAnalysis);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care Goals</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {goals.length > 0 ? (
            <div className="space-y-2">
              {goals.map((goal, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                  <p className="text-sm">{goal}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No specific goals identified
            </p>
          )}

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Goals are based on clinical data and AI analysis
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}