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

export default function Home() {
  const router = useRouter();
  const [fhirFiles, setFhirFiles] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [selectedFhirData, setSelectedFhirData] = useState<any>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [clinicalSummary, setClinicalSummary] = useState<string>("");
  const [analysis, setAnalysis] = useState<string>("");

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

  const analyzeNoteMutation = useMutation({
    mutationFn: ({ fhirData, fileName }: { fhirData: any; fileName: string }) =>
      apiService.analyzeNote(fhirData, fileName),
    onSuccess: (data) => {
      setAnalysis(data.analysis);
      if (data.clinicalSummary) {
        setClinicalSummary(data.clinicalSummary);
      }
    },
  });

  const handleLoadPatients = () => {
    setFhirFiles([]);
    setSelectedPatient("");
    setSelectedFhirData(null);
    setSelectedFileName("");
    setClinicalSummary("");
    setAnalysis("");
    loadPatientsMutation.mutate();
  };

  const handlePatientSelect = (fileName: string) => {
    setSelectedPatient(fileName);
    const selectedFile = fhirFiles.find(file => file.fileName === fileName);
    if (selectedFile) {
      setSelectedFhirData(selectedFile.fhirData);
      setSelectedFileName(selectedFile.fileName);
      setClinicalSummary("");
      setAnalysis("");
      // Analyze the selected patient's data
      analyzeNoteMutation.mutate({
        fhirData: selectedFile.fhirData,
        fileName: selectedFile.fileName
      });
    }
  };

  const isGenerating = loadPatientsMutation.isPending || analyzeNoteMutation.isPending;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">FHIR Data Analysis</h1>
            <p className="text-muted-foreground">AI-powered FHIR data analysis using Z.ai API</p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className={cn(buttonVariants({ variant: "outline" }), "text-gray-500 hover:text-gray-700")}
            >
              Logout
            </Button>
          </div>
        </div>

        <Separator />

        {!selectedFhirData ? (
          // Initial state - Patient selection
          <Card className="flex items-center justify-center h-[calc(100vh-12rem)]">
            <CardContent className="text-center">
              {loadPatientsMutation.isPending ? (
                <div>
                  <div className="mb-2 text-sm text-muted-foreground">Loading patients...</div>
                </div>
              ) : fhirFiles.length > 0 ? (
                <div className="space-y-6 max-w-md">
                  <div className="space-y-2">
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
                  <Button onClick={handleLoadPatients} disabled={isGenerating} size="lg">
                    {isGenerating ? "Loading..." : "Load Patients"}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Load FHIR patient data to begin analysis
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          // Patient selected - Dashboard layout
          <div className="space-y-6">
            {/* Top Section - Patient Info and Key Insights */}
            <div className="grid grid-cols-3 gap-6">
              {/* Left - Health Summary */}
              <div className="space-y-4">
                <PatientInfoCard fhirData={selectedFhirData} />
                <HealthSummaryCard fhirData={selectedFhirData} />
              </div>

              {/* Middle - AI Analysis */}
              <Card className="h-[500px] flex flex-col">
                <CardHeader>
                  <CardTitle>AI Analysis & Insights</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden">
                  {analyzeNoteMutation.isPending ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="mb-2 text-sm text-muted-foreground">Analyzing patient data...</div>
                      </div>
                    </div>
                  ) : analysis ? (
                    <div className="h-full overflow-y-auto pr-2">
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-muted-foreground">Analysis will appear here</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Right - Key Info Cards */}
              <div className="space-y-4">
                <ConditionSummaryCard fhirData={selectedFhirData} />
                <MedicationsCard fhirData={selectedFhirData} />
              </div>
            </div>

            {/* Bottom Section - Goals, Insights, and Data */}
            <div className="grid grid-cols-3 gap-6">
              <GoalsCard fhirData={selectedFhirData} aiAnalysis={analysis} />
              <InsightsCard fhirData={selectedFhirData} aiAnalysis={analysis} />
              <DataVisualization fhirData={selectedFhirData} />
            </div>
          </div>
        )}

        {/* Error Messages */}
        {(loadPatientsMutation.isError || analyzeNoteMutation.isError) && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">
                {loadPatientsMutation.isError
                  ? "Failed to load patients. Please check the fhir-data directory and try again."
                  : "Failed to analyze FHIR data with Z.ai API. Please check your API key and try again."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
