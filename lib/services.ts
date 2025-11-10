// API Response Types
export interface PatientInfo {
  name: string;
  id: string;
  birthDate?: string;
  gender?: string;
}

export interface FhirFile {
  fileName: string;
  patientInfo: PatientInfo;
  fhirData: any;
}

export interface GenerateNoteResponse {
  fhirFiles: FhirFile[];
  count: number;
}

export interface AnalyzeNoteResponse {
  analysis: string;
  clinicalSummary?: string;
  fileName?: string;
}

export interface LoginResponse {
  success: boolean;
  email: string;
}

export interface LogoutResponse {
  success: boolean;
}

// API Service Functions
export const apiService = {
  /**
   * Read FHIR data from directory
   */
  async generateNote(): Promise<GenerateNoteResponse> {
    const response = await fetch("/api/generate-note", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to read FHIR data");
    }

    return response.json();
  },

  /**
   * Analyze FHIR data using enhanced RAG system with vector database
   */
  async analyzeNote(fhirData: any, fileName: string, useRAG: boolean = true): Promise<AnalyzeNoteResponse> {
    // Use enhanced RAG analysis if requested
    if (useRAG) {
      const response = await fetch("/api/enhanced-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fhirData, fileName, includeVectorSearch: true }),
      });

      if (!response.ok) {
        console.warn('Enhanced analysis failed, falling back to basic analysis');
        // Fallback to basic analysis if enhanced fails
        return this.analyzeNote(fhirData, fileName, false);
      }

      return response.json();
    }

    // Basic analysis fallback
    const response = await fetch("/api/analyze-note", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fhirData, fileName }),
    });

    if (!response.ok) {
      throw new Error("Failed to analyze FHIR data");
    }

    return response.json();
  },

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Login failed");
    }

    return response.json();
  },

  /**
   * Logout the current user
   */
  async logout(): Promise<LogoutResponse> {
    const response = await fetch("/api/logout", {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Logout failed");
    }

    return response.json();
  },
};
