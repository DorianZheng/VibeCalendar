const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testGemini() {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error('❌ GEMINI_API_KEY not found in environment variables');
      return;
    }

    console.log('🤖 Testing Google Gemini API...');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
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

    const result = await model.generateContent([
      "You are a helpful AI assistant that helps users schedule events optimally. Always respond with valid JSON.",
      prompt
    ]);
    
    const response = result.response.text();
    console.log('✅ Gemini API Response:');
    console.log(response);
    
    // Try to parse as JSON to verify it's valid
    try {
      const parsed = JSON.parse(response);
      console.log('✅ Successfully parsed JSON response');
      console.log('📅 Suggested Time:', parsed.suggestedTime);
      console.log('⏱️ Duration:', parsed.duration);
      console.log('📝 Title:', parsed.title);
      console.log('💭 Reasoning:', parsed.reasoning);
    } catch (parseError) {
      console.log('⚠️ Response is not valid JSON, but API is working');
      console.log('Response preview:', response.substring(0, 200) + '...');
    }
    
  } catch (error) {
    console.error('❌ Error testing Gemini API:', error.message);
  }
}

testGemini(); 