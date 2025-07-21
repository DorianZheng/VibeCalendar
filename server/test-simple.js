const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testSimple() {
  try {
    console.log('🔑 API Key present:', !!process.env.GEMINI_API_KEY);
    console.log('🔑 API Key preview:', process.env.GEMINI_API_KEY?.substring(0, 10) + '...');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ GoogleGenerativeAI instance created');
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    console.log('✅ Model instance created');
    
    const result = await model.generateContent("Say hello");
    console.log('✅ Content generated');
    
    const response = result.response.text();
    console.log('✅ Response:', response);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('❌ Full error:', error);
  }
}

testSimple(); 