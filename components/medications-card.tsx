import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MedicationsCardProps {
  fhirData: any;
}

export function MedicationsCard({ fhirData }: MedicationsCardProps) {
  const extractMedications = (fhirData: any) => {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);

      const medications = resources.filter((r: any) =>
        r.resourceType === 'MedicationRequest' || r.resourceType === 'MedicationStatement'
      );

      // Filter for active medications
      const activeMedications = medications.filter((med: any) =>
        med.status === 'active' || med.status === 'completed'
      );

      // Get medication details
      const medicationDetails = activeMedications.slice(0, 4).map((med: any) => {
        const name = med.medicationCodeableConcept?.coding?.[0]?.display ||
                    med.medicationCodeableConcept?.text ||
                    med.medicationReference?.display ||
                    'Unknown medication';

        const dosage = med.dosageInstruction?.[0];
        const dosageText = dosage?.text ||
          (dosage?.doseAndRate?.[0]?.doseQuantity ?
            `${dosage.doseAndRate[0].doseQuantity.value || ''} ${dosage.doseAndRate[0].doseQuantity.unit || ''}` :
            '');

        return {
          name,
          dosage: dosageText,
          status: med.status,
          category: med.category?.[0]?.coding?.[0]?.display || 'General'
        };
      });

      return {
        totalMedications: medications.length,
        activeMedications: activeMedications.length,
        medications: medicationDetails
      };
    }
    return {
      totalMedications: 0,
      activeMedications: 0,
      medications: []
    };
  };

  const meds = extractMedications(fhirData);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Medications
          {meds.activeMedications > 0 && (
            <Badge variant="default">{meds.activeMedications} Active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Prescriptions:</span>
            <span className="font-medium">{meds.totalMedications}</span>
          </div>

          {meds.medications.length > 0 ? (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Current Medications:</h4>
              <div className="space-y-2">
                {meds.medications.map((med: { name: string; dosage?: string; status?: string; category?: string }, index: number) => (
                  <div key={index} className="flex items-start justify-between p-2 bg-muted/50 rounded text-xs">
                    <div className="flex-1">
                      <p className="font-medium">{med.name}</p>
                      {med.dosage && (
                        <p className="text-muted-foreground">{med.dosage}</p>
                      )}
                    </div>
                    <Badge
                      variant={med.status === 'active' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {med.status}
                    </Badge>
                  </div>
                ))}
              </div>
              {meds.activeMedications > 4 && (
                <p className="text-xs text-muted-foreground text-center">
                  +{meds.activeMedications - 4} more medications
                </p>
              )}
            </div>
          ) : meds.totalMedications > 0 ? (
            <p className="text-sm text-muted-foreground">No active medications</p>
          ) : (
            <p className="text-sm text-muted-foreground">No medications recorded</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}