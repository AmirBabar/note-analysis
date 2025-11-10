import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ConditionSummaryCardProps {
  fhirData: any;
}

export function ConditionSummaryCard({ fhirData }: ConditionSummaryCardProps) {
  const extractConditionSummary = (fhirData: any) => {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);
      const conditions = resources.filter((r: any) => r.resourceType === 'Condition');

      // Filter for chronic/active conditions
      const chronicConditions = conditions.filter((condition: any) => {
        const category = condition.category?.[0]?.coding?.[0]?.display?.toLowerCase() || '';
        const code = condition.code?.coding?.[0]?.display?.toLowerCase() || '';
        const verificationStatus = condition.verificationStatus?.coding?.[0]?.code || '';

        // Common chronic conditions
        const chronicKeywords = [
          'diabetes', 'hypertension', 'asthma', 'copd', 'heart failure', 'ckd', 'chronic',
          'depression', 'anxiety', 'bipolar', 'schizophrenia', 'arthritis', 'osteoporosis'
        ];

        const isChronic = chronicKeywords.some(keyword =>
          category.includes(keyword) || code.includes(keyword)
        );

        return isChronic && verificationStatus === 'confirmed';
      });

      // Get most recent 3 conditions
      const recentConditions = conditions
        .filter((c: any) => c.verificationStatus?.coding?.[0]?.code === 'confirmed')
        .sort((a: any, b: any) => {
          const dateA = a.onsetDateTime ? new Date(a.onsetDateTime).getTime() : 0;
          const dateB = b.onsetDateTime ? new Date(b.onsetDateTime).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, 3);

      return {
        totalConditions: conditions.length,
        chronicConditions: chronicConditions.length,
        recentConditions: recentConditions,
        activeConditions: conditions.filter((c: any) => c.clinicalStatus?.coding?.[0]?.code === 'active').length
      };
    }
    return {
      totalConditions: 0,
      chronicConditions: 0,
      recentConditions: [],
      activeConditions: 0
    };
  };

  const summary = extractConditionSummary(fhirData);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Condition Summary
          {summary.activeConditions > 0 && (
            <Badge variant="destructive">{summary.activeConditions} Active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-blue-600">{summary.totalConditions}</p>
              <p className="text-xs text-muted-foreground">Total Conditions</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-orange-600">{summary.chronicConditions}</p>
              <p className="text-xs text-muted-foreground">Chronic Conditions</p>
            </div>
          </div>

          {summary.recentConditions.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Recent Diagnoses:</h4>
              <div className="space-y-1">
                {summary.recentConditions.map((condition: any, index: number) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <span className="truncate flex-1">
                      {condition.code?.coding?.[0]?.display || condition.code?.text || 'Unknown condition'}
                    </span>
                    {condition.onsetDateTime && (
                      <span className="text-muted-foreground ml-2">
                        {(() => {
                          try {
                            const date = new Date(condition.onsetDateTime);
                            return isNaN(date.getTime()) ? 'Unknown' : date.getFullYear();
                          } catch {
                            return 'Unknown';
                          }
                        })()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.totalConditions === 0 && (
            <p className="text-sm text-muted-foreground">No conditions recorded</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}