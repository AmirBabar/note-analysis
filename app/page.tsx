"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ScoringChart } from "@/components/scoring-chart";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { PatientInfoCard } from "@/components/patient-info-card";
import { ClinicalDataDisplay } from "@/components/clinical-data-display";
import { DataVisualization } from "@/components/data-visualization";
import { HealthSummaryCard } from "@/components/health-summary-card";
import { ConditionSummaryCard } from "@/components/condition-summary-card";
import { MedicationsCard } from "@/components/medications-card";
import { GoalsCard } from "@/components/goals-card";
import { InsightsCard } from "@/components/insights-card";
import { apiService } from "@/lib/services";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Copy, ChevronDown, ChevronUp, User, Calendar, Activity } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [fhirFiles, setFhirFiles] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [selectedFhirData, setSelectedFhirData] = useState<any>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [clinicalSummary, setClinicalSummary] = useState<string>("");
  const [analysis, setAnalysis] = useState<string>("");
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: apiService.logout,
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  const loadPatientsMutation = useMutation({
    mutationFn: apiService.generateNote,
    onSuccess: (data) => {
      setFhirFiles(data.fhirFiles);
      if (data.fhirFiles.length > 0 && !selectedPatient) {
        setSelectedPatient(data.fhirFiles[0].fileName);
      }
    },
  });

  // Helper functions - moved before usage
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

  const extractHealthMetrics = (fhirData: any) => {
    if (fhirData?.resourceType === 'Bundle' && fhirData?.entry) {
      const resources = fhirData.entry.map((entry: any) => entry.resource);
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
        height: height?.valueQuantity?.value ? `${height.valueQuantity.value} ${height.valueQuantity.unit || 'cm'}` : null,
        weight: weight?.valueQuantity?.value ? `${weight.valueQuantity.value} ${weight.valueQuantity.unit || 'kg'}` : null,
        lastVisit: lastEncounter?.period?.end || lastEncounter?.period?.start,
      };
    }
    return {};
  };

  const analyzeNoteMutation = useMutation({
    mutationFn: ({ fhirData, fileName, useRAG }: { fhirData: any; fileName: string; useRAG?: boolean }) =>
      apiService.analyzeNote(fhirData, fileName, useRAG !== false),
    onSuccess: (data) => {
      setAnalysis(data.analysis);
      if (data.clinicalSummary) {
        setClinicalSummary(data.clinicalSummary);
      }
    },
  });

  const handleLoadPatients = () => {
    loadPatientsMutation.mutate();
  };

  const handlePatientSelect = (fileName: string) => {
    setSelectedPatient(fileName);
    const selectedFile = fhirFiles.find((file) => file.fileName === fileName);
    if (selectedFile) {
      setSelectedFhirData(selectedFile.fhirData);
      setSelectedFileName(selectedFile.fileName);
      setAnalysis("");
      setClinicalSummary("");

      // Auto-generate analysis when patient is selected
      analyzeNoteMutation.mutate({
        fhirData: selectedFile.fhirData,
        fileName: selectedFile.fileName,
        useRAG: true,
      });
    }
  };

  const selectedFile = fhirFiles.find((file) => file.fileName === selectedPatient);
  const patientInfo = selectedFile?.patientInfo || {};
  const healthMetrics = extractHealthMetrics(selectedFhirData);
  const calculatedAge = patientInfo.birthDate ? calculateAge(patientInfo.birthDate) : null;
  const isGenerating = loadPatientsMutation.isPending || analyzeNoteMutation.isPending;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex flex-col h-screen">
        {/* Sticky Header */}
        {selectedFhirData && patientInfo.name && (
          <header className="sticky top-0 z-50 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="px-6 py-3 h-[60px] flex items-center justify-between">
              <div className="flex items-center space-x-8">
                {/* Patient Basic Info */}
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-3">
                    <User className="h-5 w-5 text-gray-500" />
                    <div>
                      <div className="font-semibold text-base text-gray-900 dark:text-white">
                        {patientInfo.name}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {calculatedAge ? `${calculatedAge} years` : 'Age N/A'} • {patientInfo.gender || 'Gender N/A'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Health Metrics in Header */}
                <div className="flex items-center space-x-6">
                  {patientInfo.birthDate && (
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-4 w-4 text-gray-500" />
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">DOB</span>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {patientInfo.birthDate}
                        </div>
                      </div>
                    </div>
                  )}

                  {healthMetrics.lastVisit && (
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-4 w-4 text-gray-500" />
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Last Visit</span>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {(() => {
                            try {
                              const date = new Date(healthMetrics.lastVisit);
                              return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
                            } catch {
                              return 'N/A';
                            }
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {healthMetrics.height && (
                    <div className="flex items-center space-x-2">
                      <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Height</span>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {healthMetrics.height}
                        </div>
                      </div>
                    </div>
                  )}

                  {healthMetrics.weight && (
                    <div className="flex items-center space-x-2">
                      <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wide">Weight</span>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {healthMetrics.weight}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {/* Actions */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedPatient("");
                    setSelectedFhirData(null);
                    setAnalysis("");
                    setClinicalSummary("");
                  }}
                >
                  Change Patient
                </Button>

                <Button
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  variant="outline"
                  size="sm"
                >
                  Logout
                </Button>
              </div>
            </div>
          </header>
        )}

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {!selectedFhirData ? (
            // Initial state - Patient selection
            <div className="flex-1 flex items-center justify-center p-8">
              <Card className="max-w-md w-full">
                <CardContent className="text-center p-8">
                  {loadPatientsMutation.isPending ? (
                    <div>
                      <div className="mb-2 text-sm text-muted-foreground">Loading patients...</div>
                    </div>
                  ) : fhirFiles.length > 0 ? (
                    <div className="space-y-6">
                      <div className="space-y-2 text-left">
                        <Label htmlFor="patient-select">Select Patient</Label>
                        <select
                          id="patient-select"
                          className="w-full p-3 border border-input bg-background rounded-md"
                          value={selectedPatient}
                          onChange={(e) => handlePatientSelect(e.target.value)}
                          disabled={isGenerating}
                        >
                          <option value="">Choose a patient...</option>
                          {fhirFiles.map((file) => (
                            <option key={file.fileName} value={file.fileName}>
                              {file.patientInfo.name}
                              {file.patientInfo.birthDate && ` (${file.patientInfo.birthDate})`}
                              {file.patientInfo.gender && ` - ${file.patientInfo.gender}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      {!selectedPatient && (
                        <p className="text-sm text-muted-foreground">
                          Please select a patient to view their comprehensive health analysis
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Activity className="h-12 w-12 mx-auto text-gray-400" />
                      <Button onClick={handleLoadPatients} disabled={isGenerating} size="lg" className="w-full">
                        {isGenerating ? "Loading..." : "Load Patients"}
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        Load FHIR patient data to begin analysis
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            // Patient selected - Two-column layout
            <>
              {/* Main Content Area (70%) */}
              <div className="flex-1 flex flex-col overflow-hidden" style={{ maxWidth: '70%' }}>
                {/* Top Row - AI Analysis & Insights (60% of vertical space) */}
                <div className="flex-1 p-6 pb-4" style={{ height: '60%' }}>
                  <Card className="h-full flex flex-col">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center space-x-2">
                        <Activity className="h-5 w-5" />
                        <span>AI Analysis & Insights</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden">
                      {analyzeNoteMutation.isPending ? (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center">
                            <div className="animate-spin h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                            <div className="text-sm text-muted-foreground">Analyzing patient data with RAG...</div>
                          </div>
                        </div>
                      ) : analysis ? (
                        <div className="h-full overflow-y-auto pr-2 prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-center">
                          <p className="text-muted-foreground">Analysis will appear here</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Bottom Row - Condition Summary & Medications (40% of vertical space) */}
                <div className="flex-none p-6 pt-0" style={{ height: '40%' }}>
                  <div className="grid grid-cols-2 gap-6 h-full">
                    <ConditionSummaryCard fhirData={selectedFhirData} />
                    <MedicationsCard fhirData={selectedFhirData} />
                  </div>
                </div>
              </div>

              {/* Right Sidebar (30%) - Only Care Gaps & Goals */}
              <div className="w-full p-6 overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50" style={{ maxWidth: '30%' }}>
                {/* Care Gaps & Goals Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Care Gaps & Goals</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Static content for now */}
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Active Care Gaps</h4>
                        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                          <li>• Annual wellness visit overdue</li>
                          <li>• Preventive screening gaps</li>
                        </ul>
                      </div>

                      {/* Expandable Goals Section */}
                      <div>
                        <button
                          onClick={() => setIsGoalsExpanded(!isGoalsExpanded)}
                          className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        >
                          <span className="font-medium text-gray-900 dark:text-white">Care Goals</span>
                          {isGoalsExpanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                          )}
                        </button>

                        {isGoalsExpanded && (
                          <div className="mt-2 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
                            <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
                              <li>• Improve blood pressure control</li>
                              <li>• Maintain medication adherence</li>
                              <li>• Schedule follow-up appointments</li>
                              <li>• Lifestyle modification goals</li>
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}