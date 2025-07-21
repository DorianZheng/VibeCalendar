const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const geminiAgent = geminiProxy ? new HttpsProxyAgent(geminiProxy) : undefined;

async function testModel(modelName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
  const body = {
    contents: [
      { parts: [{ text: 'Hello, please respond with just "OK" to test connectivity.' }] }
    ]
  };
  const options = {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  };
  if (geminiAgent) options.httpsAgent = geminiAgent;
  
  try {
    console.log(`🧪 Testing model: ${modelName}`);
    const startTime = Date.now();
    const response = await axios.post(url, body, options);
    const endTime = Date.now();
    
    const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`✅ ${modelName}: SUCCESS (${endTime - startTime}ms)`);
    console.log(`   Response: "${aiResponse}"`);
    return { success: true, model: modelName, responseTime: endTime - startTime, response: aiResponse };
  } catch (error) {
    console.log(`❌ ${modelName}: FAILED`);
    console.log(`   Error: ${error.response?.status} - ${error.response?.data?.error?.message || error.message}`);
    return { success: false, model: modelName, error: error.response?.data?.error?.message || error.message };
  }
}

async function testAllModels() {
  const models = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash-lite',
    'gemma-3-4b-it'
  ];
  
  console.log('🚀 Testing Gemini Models for Availability...\n');
  
  const results = [];
  for (const model of models) {
    const result = await testModel(model);
    results.push(result);
    console.log(''); // Empty line for readability
  }
  
  console.log('📊 SUMMARY:');
  console.log('===========');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    console.log('✅ WORKING MODELS:');
    successful.forEach(r => {
      console.log(`   ${r.model} (${r.responseTime}ms)`);
    });
  }
  
  if (failed.length > 0) {
    console.log('❌ FAILED MODELS:');
    failed.forEach(r => {
      console.log(`   ${r.model}: ${r.error}`);
    });
  }
  
  // Recommend the fastest working model
  if (successful.length > 0) {
    const fastest = successful.reduce((prev, current) => 
      prev.responseTime < current.responseTime ? prev : current
    );
    console.log(`\n🏆 RECOMMENDED: ${fastest.model} (fastest at ${fastest.responseTime}ms)`);
  }
}

if (!geminiApiKey) {
  console.error('❌ GEMINI_API_KEY environment variable is not set');
  process.exit(1);
}

testAllModels().catch(console.error); 