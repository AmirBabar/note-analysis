import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface HealthSummaryCardProps {
  fhirData: any;
}

export function HealthSummaryCard({ fhirData }: HealthSummaryCardProps) {
  const calculateAge = (birthDate: string) => {
    if (!birthDate) return null;
    try {
      const today = new Date();
      const birth = new Date(birthDate);
      if (isNaN(birth.getTime())) return null;
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    } catch (error) {
      return null;
    }
  };

  const extractHealthSummary = (fhirData: any) => {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);

      const patient = resources.find((r: any) => r.resourceType === 'Patient');
      const observations = resources.filter((r: any) => r.resourceType === 'Observation');
      const encounters = resources.filter((r: any) => r.resourceType === 'Encounter');

      // Find height and weight
      const height = observations.find((obs: any) =>
        obs.code?.coding?.[0]?.code === '8302-2' ||
        obs.code?.text?.toLowerCase().includes('height')
      );

      const weight = observations.find((obs: any) =>
        obs.code?.coding?.[0]?.code === '29463-7' ||
        obs.code?.text?.toLowerCase().includes('weight')
      );

      // Find last encounter date
      const lastEncounter = encounters
        .filter((enc: any) => {
          const dateStr = enc.period?.end || enc.period?.start;
          if (!dateStr) return false;
          const date = new Date(dateStr);
          return !isNaN(date.getTime());
        })
        .sort((a: any, b: any) => {
          const dateA = new Date(a.period?.end || a.period?.start);
          const dateB = new Date(b.period?.end || b.period?.start);
          return dateB.getTime() - dateA.getTime();
        })[0];

      return {
        age: patient?.birthDate ? calculateAge(patient.birthDate) : null,
        height: height?.valueQuantity?.value ? `${height.valueQuantity.value} ${height.valueQuantity.unit || 'cm'}` : null,
        weight: weight?.valueQuantity?.value ? `${weight.valueQuantity.value} ${weight.valueQuantity.unit || 'kg'}` : null,
        lastVisit: lastEncounter?.period?.end || lastEncounter?.period?.start,
        bmi: height?.valueQuantity?.value && weight?.valueQuantity?.value ?
          (weight.valueQuantity.value / Math.pow(height.valueQuantity.value / 100, 2)).toFixed(1) : null
      };
    }
    return {};
  };

  const summary = extractHealthSummary(fhirData);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {summary.age !== null && (
            <div className="flex items-center justify-between">
              <span className="font-medium">Age:</span>
              <span>{summary.age} years</span>
            </div>
          )}

          {summary.height && (
            <div className="flex items-center justify-between">
              <span className="font-medium">Height:</span>
              <span>{summary.height}</span>
            </div>
          )}

          {summary.weight && (
            <div className="flex items-center justify-between">
              <span className="font-medium">Weight:</span>
              <span>{summary.weight}</span>
            </div>
          )}

          {summary.bmi && (
            <div className="flex items-center justify-between">
              <span className="font-medium">BMI:</span>
              <div className="flex items-center gap-2">
                <span>{summary.bmi}</span>
                <Badge variant={
                  parseFloat(summary.bmi) < 18.5 ? 'secondary' :
                  parseFloat(summary.bmi) < 25 ? 'default' :
                  parseFloat(summary.bmi) < 30 ? 'destructive' : 'destructive'
                }>
                  {parseFloat(summary.bmi) < 18.5 ? 'Underweight' :
                   parseFloat(summary.bmi) < 25 ? 'Normal' :
                   parseFloat(summary.bmi) < 30 ? 'Overweight' : 'Obese'}
                </Badge>
              </div>
            </div>
          )}

          {summary.lastVisit && (
            <div className="flex items-center justify-between">
              <span className="font-medium">Last Visit:</span>
              <span>
                {(() => {
                  try {
                    const date = new Date(summary.lastVisit);
                    return isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleDateString();
                  } catch {
                    return 'Invalid date';
                  }
                })()}
              </span>
            </div>
          )}

          {!summary.age && !summary.height && !summary.weight && !summary.lastVisit && (
            <p className="text-sm text-muted-foreground">No health metrics available</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}