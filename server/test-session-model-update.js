const axios = require('axios');
require('dotenv').config();

async function testSessionModelUpdate() {
  console.log('🧪 Testing reactive session model update...');
  
  try {
    // Test the admin endpoint to force update all sessions
    const response = await axios.post('http://localhost:50001/api/admin/update-session-models');
    
    console.log('✅ Admin endpoint response:', response.data);
    
    // Test a session validation request
    const sessionResponse = await axios.get('http://localhost:50001/api/auth/session', {
      headers: {
        'x-session-id': '17528332...' // Use the session ID from logs
      }
    });
    
    console.log('✅ Session validation response:', sessionResponse.data);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testSessionModelUpdate(); 