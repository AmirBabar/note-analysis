import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, TrendingUp, Info } from "lucide-react";

interface InsightsCardProps {
  fhirData: any;
  aiAnalysis: string;
}

export function InsightsCard({ fhirData, aiAnalysis }: InsightsCardProps) {
  const extractInsights = (fhirData: any, analysis: string) => {
    const insights: {
      type: 'warning' | 'success' | 'info' | 'trend';
      title: string;
      description: string;
    }[] = [];

    // Extract warnings and insights from AI analysis
    const lines = analysis.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim().toLowerCase();

      // Look for warning indicators
      if (trimmedLine.includes('concern') ||
          trimmedLine.includes('elevated') ||
          trimmedLine.includes('high') ||
          trimmedLine.includes('abnormal') ||
          trimmedLine.includes('uncontrolled') ||
          trimmedLine.includes('warning')) {
        const fullLine = line.trim();
        if (fullLine.length > 20 && insights.length < 6) {
          insights.push({
            type: 'warning',
            title: 'Clinical Alert',
            description: fullLine.replace(/^[\d\.\-\*\s]+/, '')
          });
        }
      }

      // Look for positive indicators
      if (trimmedLine.includes('well controlled') ||
          trimmedLine.includes('good') ||
          trimmedLine.includes('normal') ||
          trimmedLine.includes('stable') ||
          trimmedLine.includes('improved')) {
        const fullLine = line.trim();
        if (fullLine.length > 20 && insights.length < 6) {
          insights.push({
            type: 'success',
            title: 'Positive Indicator',
            description: fullLine.replace(/^[\d\.\-\*\s]+/, '')
          });
        }
      }
    }

    // Generate insights from FHIR data if no insights found
    if (insights.length === 0) {
      return generateInsightsFromFHIR(fhirData);
    }

    return insights.slice(0, 4);
  };

  const generateInsightsFromFHIR = (fhirData: any) => {
    const insights: {
      type: 'warning' | 'success' | 'info' | 'trend';
      title: string;
      description: string;
    }[] = [];

    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);
      const conditions = resources.filter((r: any) => r.resourceType === 'Condition');
      const observations = resources.filter((r: any) => r.resourceType === 'Observation');

      // Check for multiple chronic conditions
      const chronicConditions = conditions.filter((c: any) => {
        const code = c.code?.coding?.[0]?.display?.toLowerCase() || '';
        return code.includes('diabetes') || code.includes('hypertension') || code.includes('heart');
      });

      if (chronicConditions.length >= 2) {
        insights.push({
          type: 'info',
          title: 'Complex Care',
          description: 'Multiple chronic conditions require coordinated care'
        });
      }

      // Check glucose levels
      const glucoseObs = observations.find((obs: any) =>
        obs.code?.coding?.[0]?.code === '2345-7' ||
        obs.code?.text?.toLowerCase().includes('glucose')
      );

      if (glucoseObs && glucoseObs.valueQuantity?.value > 140) {
        insights.push({
          type: 'warning',
          title: 'Glucose Alert',
          description: `Elevated glucose: ${glucoseObs.valueQuantity.value} ${glucoseObs.valueQuantity.unit || 'mg/dL'}`
        });
      } else if (glucoseObs && glucoseObs.valueQuantity?.value < 140) {
        insights.push({
          type: 'success',
          title: 'Glucose Normal',
          description: `Glucose well controlled: ${glucoseObs.valueQuantity.value} ${glucoseObs.valueQuantity.unit || 'mg/dL'}`
        });
      }

      // Check blood pressure
      const systolicObs = observations.find((obs: any) =>
        obs.code?.coding?.[0]?.code === '8480-6'
      );
      const diastolicObs = observations.find((obs: any) =>
        obs.code?.coding?.[0]?.code === '8462-4'
      );

      if (systolicObs && diastolicObs) {
        const systolic = systolicObs.valueQuantity?.value;
        const diastolic = diastolicObs.valueQuantity?.value;

        if (systolic > 140 || diastolic > 90) {
          insights.push({
            type: 'warning',
            title: 'BP Alert',
            description: `Elevated BP: ${systolic}/${diastolic} mmHg`
          });
        } else if (systolic && diastolic) {
          insights.push({
            type: 'success',
            title: 'BP Normal',
            description: `Blood pressure well controlled: ${systolic}/${diastolic} mmHg`
          });
        }
      }

      // Check recent encounters
      const recentEncounters = resources.filter((r: any) => {
        if (r.resourceType === 'Encounter' && r.period?.end) {
          try {
            const encounterDate = new Date(r.period.end);
            if (isNaN(encounterDate.getTime())) return false;
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            return encounterDate > threeMonthsAgo;
          } catch {
            return false;
          }
        }
        return false;
      });

      if (recentEncounters.length === 0 && chronicConditions.length > 0) {
        insights.push({
          type: 'info',
          title: 'Follow-up Needed',
          description: 'Consider scheduling a check-up for chronic condition management'
        });
      }

      if (recentEncounters.length > 0) {
        insights.push({
          type: 'trend',
          title: 'Recent Care',
          description: `${recentEncounters.length} healthcare encounter${recentEncounters.length > 1 ? 's' : ''} in last 3 months`
        });
      }
    }

    // Default insights if none generated
    if (insights.length === 0) {
      insights.push({
        type: 'info',
        title: 'Data Available',
        description: 'Patient health data is ready for review'
      });
    }

    return insights.slice(0, 4);
  };

  const insights = extractInsights(fhirData, aiAnalysis);

  const getIcon = (type: string) => {
    switch (type) {
      case 'warning': return <AlertTriangle className="w-4 h-4" />;
      case 'success': return <CheckCircle className="w-4 h-4" />;
      case 'trend': return <TrendingUp className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  const getVariant = (type: string) => {
    switch (type) {
      case 'warning': return 'destructive';
      case 'success': return 'default';
      case 'trend': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key Insights & Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {insights.length > 0 ? (
            <div className="space-y-2">
              {insights.map((insight, index) => (
                <div key={index} className="flex items-start gap-3 p-2 rounded-lg border">
                  <div className={`mt-0.5 ${
                    insight.type === 'warning' ? 'text-red-500' :
                    insight.type === 'success' ? 'text-green-500' :
                    insight.type === 'trend' ? 'text-blue-500' :
                    'text-gray-500'
                  }`}>
                    {getIcon(insight.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={getVariant(insight.type)} className="text-xs">
                        {insight.title}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {insight.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No specific insights available
            </p>
          )}

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Insights are generated from clinical data and AI analysis
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}