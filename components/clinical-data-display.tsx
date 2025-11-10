import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ClinicalDataDisplayProps {
  fhirData: any;
}

export function ClinicalDataDisplay({ fhirData }: ClinicalDataDisplayProps) {
  const extractClinicalData = (fhirData: any) => {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);

      const conditions = resources.filter((r: any) => r.resourceType === 'Condition');
      const observations = resources.filter((r: any) => r.resourceType === 'Observation');
      const encounters = resources.filter((r: any) => r.resourceType === 'Encounter');
      const medications = resources.filter((r: any) => r.resourceType === 'MedicationRequest');

      return { conditions, observations, encounters, medications };
    }
    return { conditions: [], observations: [], encounters: [], medications: [] };
  };

  const { conditions, observations, encounters, medications } = extractClinicalData(fhirData);

  return (
    <Tabs defaultValue="conditions" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="conditions">Conditions ({conditions.length})</TabsTrigger>
        <TabsTrigger value="observations">Observations ({observations.length})</TabsTrigger>
        <TabsTrigger value="encounters">Encounters ({encounters.length})</TabsTrigger>
        <TabsTrigger value="medications">Medications ({medications.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="conditions" className="space-y-3">
        {conditions.length > 0 ? (
          conditions.map((condition: any, index: number) => (
            <Card key={index}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">
                      {condition.code?.coding?.[0]?.display || condition.code?.text || 'Unknown condition'}
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {condition.code?.coding?.[0]?.code && `Code: ${condition.code.coding[0].code}`}
                    </p>
                    {condition.onsetDateTime && (
                      <p className="text-sm text-muted-foreground">
                        Onset: {new Date(condition.onsetDateTime).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Badge variant={condition.verificationStatus?.coding?.[0]?.code === 'confirmed' ? 'default' : 'secondary'}>
                    {condition.verificationStatus?.coding?.[0]?.display || 'Unknown'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-muted-foreground">No conditions found</p>
        )}
      </TabsContent>

      <TabsContent value="observations" className="space-y-3">
        {observations.length > 0 ? (
          observations.map((observation: any, index: number) => (
            <Card key={index}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">
                      {observation.code?.coding?.[0]?.display || observation.code?.text || 'Unknown observation'}
                    </h4>
                    <p className="text-lg font-semibold mt-1">
                      {observation.valueQuantity ?
                        `${observation.valueQuantity.value} ${observation.valueQuantity.unit || ''}` :
                        'No value recorded'
                      }
                    </p>
                    {observation.effectiveDateTime && (
                      <p className="text-sm text-muted-foreground">
                        Date: {new Date(observation.effectiveDateTime).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {observation.interpretation?.[0]?.coding?.[0] && (
                    <Badge variant={
                      observation.interpretation[0].coding[0].code === 'H' ? 'destructive' :
                      observation.interpretation[0].coding[0].code === 'L' ? 'default' : 'secondary'
                    }>
                      {observation.interpretation[0].coding[0].display}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-muted-foreground">No observations found</p>
        )}
      </TabsContent>

      <TabsContent value="encounters" className="space-y-3">
        {encounters.length > 0 ? (
          encounters.map((encounter: any, index: number) => (
            <Card key={index}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">
                      {encounter.class?.display || encounter.type?.[0]?.coding?.[0]?.display || 'Encounter'}
                    </h4>
                    {encounter.period?.start && (
                      <p className="text-sm text-muted-foreground">
                        {new Date(encounter.period.start).toLocaleDateString()} -
                        {encounter.period.end ? new Date(encounter.period.end).toLocaleDateString() : 'Ongoing'}
                      </p>
                    )}
                    {encounter.reasonCode?.length > 0 && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Reason: {encounter.reasonCode[0].coding?.[0]?.display || 'Unknown'}
                      </p>
                    )}
                  </div>
                  <Badge variant={encounter.status === 'finished' ? 'default' : 'secondary'}>
                    {encounter.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-muted-foreground">No encounters found</p>
        )}
      </TabsContent>

      <TabsContent value="medications" className="space-y-3">
        {medications.length > 0 ? (
          medications.map((medication: any, index: number) => (
            <Card key={index}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">
                      {medication.medicationCodeableConcept?.coding?.[0]?.display ||
                       medication.medicationReference?.display ||
                       'Unknown medication'}
                    </h4>
                    {medication.dosageInstruction?.[0] && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {medication.dosageInstruction[0].text ||
                         `${medication.dosageInstruction[0].doseAndRate?.[0]?.doseQuantity?.value || ''}
                          ${medication.dosageInstruction[0].doseAndRate?.[0]?.doseQuantity?.unit || ''}`}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Status: {medication.status}
                    </p>
                  </div>
                  <Badge variant={medication.status === 'active' ? 'default' : 'secondary'}>
                    {medication.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-muted-foreground">No medications found</p>
        )}
      </TabsContent>
    </Tabs>
  );
}