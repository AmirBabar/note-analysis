import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface DataVisualizationProps {
  fhirData: any;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function DataVisualization({ fhirData }: DataVisualizationProps) {
  const extractVisualizationData = (fhirData: any) => {
    if (fhirData.resourceType === 'Bundle' && fhirData.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);

      const conditions = resources.filter((r: any) => r.resourceType === 'Condition');
      const observations = resources.filter((r: any) => r.resourceType === 'Observation');
      const encounters = resources.filter((r: any) => r.resourceType === 'Encounter');

      // Resource type distribution
      const resourceDistribution = [
        { name: 'Conditions', value: conditions.length, color: '#0088FE' },
        { name: 'Observations', value: observations.length, color: '#00C49F' },
        { name: 'Encounters', value: encounters.length, color: '#FFBB28' },
      ];

      // Condition categories
      const conditionCategories = conditions.reduce((acc: any, condition: any) => {
        const category = condition.category?.[0]?.coding?.[0]?.display || 'Uncategorized';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {});

      const categoryData = Object.entries(conditionCategories).map(([name, value]) => ({
        name,
        value: value as number
      }));

      // Recent observations with values
      const numericObservations = observations
        .filter((obs: any) => obs.valueQuantity?.value !== undefined)
        .slice(0, 10)
        .map((obs: any) => ({
          name: obs.code?.coding?.[0]?.display || obs.code?.text || 'Unknown',
          value: obs.valueQuantity.value,
          unit: obs.valueQuantity.unit || '',
          date: obs.effectiveDateTime
        }));

      return {
        resourceDistribution,
        categoryData,
        numericObservations
      };
    }
    return {
      resourceDistribution: [],
      categoryData: [],
      numericObservations: []
    };
  };

  const { resourceDistribution, categoryData, numericObservations } = extractVisualizationData(fhirData);

  if (resourceDistribution.length === 0 && categoryData.length === 0 && numericObservations.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No data available for visualization</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resource Distribution Pie Chart */}
      {resourceDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resource Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={resourceDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {resourceDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Condition Categories Bar Chart */}
      {categoryData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Condition Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#0088FE" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Observations */}
      {numericObservations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Observations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {numericObservations.map((obs: { name: string; value: number; unit: string; date?: string }, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{obs.name}</h4>
                    {obs.date && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(obs.date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {obs.value} {obs.unit}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Data Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">
                {resourceDistribution.find(r => r.name === 'Conditions')?.value || 0}
              </p>
              <p className="text-sm text-muted-foreground">Conditions</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                {resourceDistribution.find(r => r.name === 'Observations')?.value || 0}
              </p>
              <p className="text-sm text-muted-foreground">Observations</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-600">
                {resourceDistribution.find(r => r.name === 'Encounters')?.value || 0}
              </p>
              <p className="text-sm text-muted-foreground">Encounters</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}