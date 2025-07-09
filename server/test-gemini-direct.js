const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
require('dotenv').config();

const geminiProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiAgent = geminiProxy ? new (HttpsProxyAgent.HttpsProxyAgent || HttpsProxyAgent)(geminiProxy) : undefined;

async function geminiGenerateContent({ model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
  const body = {
    contents: [
      { parts: [{ text: prompt }] }
    ]
  };
  const options = {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000
  };
  if (geminiAgent) options.httpsAgent = geminiAgent;
  const response = await axios.post(url, body, options);
  return response.data;
}

async function testGeminiDirect() {
  try {
    if (!geminiApiKey) {
      console.error('❌ GEMINI_API_KEY not found in environment variables');
      console.log('💡 Make sure you have a .env file in the server directory with GEMINI_API_KEY=your_key_here');
      return;
    }

    console.log('🤖 Testing Google Gemini API with direct HTTP calls...');
    console.log('🔑 API Key found:', geminiApiKey.substring(0, 10) + '...');
    
    if (geminiProxy) {
      console.log('🌐 Using proxy:', geminiProxy);
    } else {
      console.log('🌐 No proxy configured');
    }
    
    const prompt = `
You are an AI assistant helping to schedule events. Given the following information, suggest the best time and details for the event:

Event Description: Team meeting to discuss Q4 strategy
User Preferences: Prefer morning meetings, avoid Mondays
Existing events: None

Please provide a JSON response with the following structure:
{
  "suggestedTime": "YYYY-MM-DDTHH:MM:SS",
  "duration": "HH:MM",
  "title": "Event title",
  "description": "Detailed description",
  "location": "Location if applicable",
  "attendees": ["email1@example.com", "email2@example.com"],
  "reminders": ["15 minutes before", "1 hour before"],
  "reasoning": "Explanation of why this time was chosen"
}
`;

    console.log('📤 Sending request to Gemini API...');
    const data = await geminiGenerateContent({ model: 'gemini-1.5-pro', prompt });
    
    console.log('✅ Gemini API Response received!');
    console.log('📊 Response structure:', Object.keys(data));
    
    if (data.candidates && data.candidates.length > 0) {
      const aiResponse = data.candidates[0].content.parts[0].text;
      console.log('🤖 AI Response:');
      console.log(aiResponse);
      
      // Try to parse as JSON to verify it's valid
      try {
        const parsed = JSON.parse(aiResponse);
        console.log('✅ Successfully parsed JSON response');
        console.log('📅 Suggested Time:', parsed.suggestedTime);
        console.log('⏱️ Duration:', parsed.duration);
        console.log('📝 Title:', parsed.title);
        console.log('💭 Reasoning:', parsed.reasoning);
      } catch (parseError) {
        console.log('⚠️ Response is not valid JSON, but API is working');
        console.log('Response preview:', aiResponse.substring(0, 200) + '...');
      }
    } else {
      console.log('⚠️ No candidates in response:', data);
    }
    
  } catch (error) {
    console.error('❌ Error testing Gemini API:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    } else if (error.request) {
      console.error('Request error:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
    
    // Provide troubleshooting tips
    console.log('\n🔧 Troubleshooting tips:');
    console.log('1. Check if your API key is correct');
    console.log('2. Verify the Gemini API is enabled in your Google Cloud project');
    console.log('3. Check if you have billing set up (even for free tier)');
    console.log('4. Verify your project has the necessary permissions');
    console.log('5. Check if you have any rate limiting or quota issues');
  }
}

testGeminiDirect(); 