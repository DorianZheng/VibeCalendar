const geminiApiKey = process.env.GEMINI_API_KEY;

console.log('🔑 API Key present:', !!geminiApiKey);
console.log('🔑 API Key preview:', geminiApiKey?.substring(0, 10) + '...');

if (!geminiApiKey) {
  console.error('❌ GEMINI_API_KEY not found in environment variables');
  process.exit(1);
}

async function testGemini() {
  try {
    console.log('🔄 Testing Gemini API connection...');
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: 'Hello' }]
        }]
      }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Gemini API test successful!');
    console.log('Response preview:', data.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 100) + '...');
    
  } catch (error) {
    console.error('❌ Gemini API test failed:', error.message);
    if (error.name === 'AbortError') {
      console.error('❌ Request timed out after 10 seconds');
    }
  }
}

testGemini(); 