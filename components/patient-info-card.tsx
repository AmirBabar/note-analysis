import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PatientInfoCardProps {
  fhirData: any;
}

export function PatientInfoCard({ fhirData }: PatientInfoCardProps) {
  const extractPatientInfo = (fhirData: any) => {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);
      const patient = resources.find((r: any) => r.resourceType === 'Patient');

      if (patient) {
        const name = patient.name?.[0];
        return {
          name: name ? `${name.given?.[0] || ''} ${name.family || ''}`.trim() : 'Unknown',
          birthDate: patient.birthDate,
          gender: patient.gender,
          id: patient.id
        };
      }
    }
    return null;
  };

  const patient = extractPatientInfo(fhirData);

  if (!patient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Patient Information</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No patient information found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Patient Information
          <Badge variant={patient.gender === 'male' ? 'default' : 'secondary'}>
            {patient.gender}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">Name:</span>
            <span>{patient.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">Birth Date:</span>
            <span>{patient.birthDate || 'Not specified'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">Patient ID:</span>
            <span className="text-sm text-muted-foreground font-mono">{patient.id}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}