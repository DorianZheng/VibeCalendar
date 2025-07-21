const axios = require('axios');
require('dotenv').config();

async function testAxiosGemini() {
  try {
    console.log('🔑 API Key present:', !!process.env.GEMINI_API_KEY);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const data = {
      contents: [
        {
          parts: [
            {
              text: "Say hello"
            }
          ]
        }
      ]
    };
    
    console.log('📤 Sending request to Gemini API...');
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Response received:');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('❌ Response status:', error.response.status);
      console.error('❌ Response data:', error.response.data);
    }
  }
}

testAxiosGemini(); 