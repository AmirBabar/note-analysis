// Test script for RAG functionality
const testRAG = async () => {
  console.log('🧪 Testing RAG System...\n');

  try {
    // Test 1: Initialize Vector Database
    console.log('1️⃣ Testing vector database initialization...');
    const initResponse = await fetch('http://localhost:3004/api/vector-db', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'initialize'
      })
    });

    const initData = await initResponse.json();
    console.log('✅ Vector DB Initialization:', initData.success ? 'Success' : 'Failed');
    if (!initData.success) {
      console.log('❌ Error:', initData.error);
    }

    // Test 2: Check vector database stats
    console.log('\n2️⃣ Testing vector database stats...');
    const statsResponse = await fetch('http://localhost:3004/api/vector-db?action=stats');
    const statsData = await statsResponse.json();
    console.log('📊 Current DB Stats:', statsData.stats || 'No stats available');

    // Test 3: Test analyze-note API with RAG
    console.log('\n3️⃣ Testing RAG-enhanced analysis...');

    // Sample FHIR data for testing
    const sampleFHIRData = {
      resourceType: 'Bundle',
      id: 'test-bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'patient-123',
            name: [{
              given: ['John'],
              family: 'Doe'
            }],
            gender: 'male',
            birthDate: '1970-01-01'
          }
        },
        {
          resource: {
            resourceType: 'Condition',
            id: 'condition-1',
            code: {
              coding: [{
                system: 'http://snomed.info/sct',
                code: '44054006',
                display: 'Diabetes mellitus type 2'
              }]
            },
            clinicalStatus: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                code: 'active'
              }]
            }
          }
        },
        {
          resource: {
            resourceType: 'DocumentReference',
            id: 'doc-1',
            subject: { reference: 'Patient/patient-123' },
            author: [{ display: 'Dr. Smith' }],
            date: '2024-01-15T10:00:00Z',
            type: {
              coding: [{
                display: 'Progress Note'
              }]
            },
            content: [{
              attachment: {
                data: Buffer.from('Patient presents with uncontrolled diabetes. Blood glucose levels consistently above 200 mg/dL. Patient reports difficulty with medication adherence. Recommending tighter glucose monitoring and diabetes education referral.').toString('base64')
              }
            }]
          }
        }
      ]
    };

    const analyzeResponse = await fetch('http://localhost:3004/api/analyze-note', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fhirData: sampleFHIRData,
        fileName: 'test-patient.json',
        useRAG: true
      })
    });

    const analyzeData = await analyzeResponse.json();
    console.log('✅ Analysis Response Status:', analyzeResponse.ok ? 'Success' : 'Failed');

    if (analyzeData.error) {
      console.log('❌ Analysis Error:', analyzeData.error);
    } else {
      console.log('📄 Analysis completed successfully');
      console.log('🔍 RAG Context:', analyzeData.ragContext);
      console.log('📊 Vector Search Results:', analyzeData.vectorSearchResults);
      console.log('👤 Patient ID:', analyzeData.patientId);

      // Check if the analysis contains the expected emoji indicators
      const analysis = analyzeData.analysis;
      const hasRequiredEmojis = analysis?.includes('🔴') && analysis?.includes('🟡') && analysis?.includes('🔵');
      console.log('🎯 Required Emoji Format:', hasRequiredEmojis ? '✅ Present' : '❌ Missing');

      if (analysis) {
        console.log('\n📋 Sample Analysis (first 500 chars):');
        console.log(analysis.substring(0, 500) + (analysis.length > 500 ? '...' : ''));
      }
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }

  console.log('\n🏁 RAG Testing Complete!');
};

// Run the test
testRAG();