const axios = require('axios');

// Test the logging system
async function testLogging() {
  console.log('🧪 Testing comprehensive RPC logging system...\n');
  
  // Test 1: Basic API call
  console.log('📋 Test 1: Basic API call to health endpoint');
  try {
    const response = await axios.get('http://localhost:50001/api/health');
    console.log('✅ Health check successful:', response.status);
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 2: API call with data
  console.log('📋 Test 2: API call with request body');
  try {
    const response = await axios.post('http://localhost:50001/api/ai/schedule', {
      description: 'Test logging system',
      preferences: 'none',
      existingEvents: []
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': 'test-session-123'
      }
    });
    console.log('✅ AI schedule call successful:', response.status);
  } catch (error) {
    console.log('❌ AI schedule call failed:', error.response?.status || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 3: Error case
  console.log('📋 Test 3: Error case (invalid endpoint)');
  try {
    const response = await axios.get('http://localhost:50001/api/nonexistent');
    console.log('✅ Unexpected success:', response.status);
  } catch (error) {
    console.log('❌ Expected error:', error.response?.status || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  console.log('🎉 Logging test completed! Check the console output above for detailed logs.');
  console.log('\nExpected log patterns:');
  console.log('- 🌐 [RPC] REQUEST [ID]: Client requests');
  console.log('- ✅ [RPC] RESPONSE [ID]: Client responses');
  console.log('- 🌐 [SERVER] REQUEST [ID]: Server incoming requests');
  console.log('- ✅ [SERVER] RESPONSE [ID]: Server outgoing responses');
  console.log('- 🌐 [EXTERNAL] GEMINI REQUEST [ID]: External API calls');
  console.log('- ✅ [EXTERNAL] GEMINI RESPONSE [ID]: External API responses');
}

// Run the test
testLogging().catch(console.error); 