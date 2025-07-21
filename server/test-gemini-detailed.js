const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
require('dotenv').config();

const geminiProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiAgent = geminiProxy ? new (HttpsProxyAgent.HttpsProxyAgent || HttpsProxyAgent)(geminiProxy) : undefined;

async function testGeminiDetailed() {
  try {
    if (!geminiApiKey) {
      console.error('❌ GEMINI_API_KEY not found in environment variables');
      return;
    }

    console.log('🔍 Detailed Gemini API Diagnostics...');
    console.log('🔑 API Key:', geminiApiKey.substring(0, 10) + '...');
    console.log('🌐 Proxy:', geminiProxy || 'None');
    
    // Test 1: Check if we can reach the API at all
    console.log('\n📡 Test 1: Basic connectivity...');
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`;
      const options = {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      };
      if (geminiAgent) options.httpsAgent = geminiAgent;
      
      const response = await axios.get(url, options);
      console.log('✅ Can reach Gemini API - Models endpoint works');
      console.log('📊 Available models:', response.data.data?.map(m => m.name) || 'None');
    } catch (error) {
      console.log('❌ Cannot reach Gemini API models endpoint');
      if (error.response) {
        console.log('Status:', error.response.status);
        console.log('Error:', error.response.data);
      }
    }
    
    // Test 2: Try a simple generation request
    console.log('\n🤖 Test 2: Simple generation request...');
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiApiKey}`;
      const body = {
        contents: [
          { parts: [{ text: "Say 'Hello World'" }] }
        ]
      };
      const options = {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      };
      if (geminiAgent) options.httpsAgent = geminiAgent;
      
      const response = await axios.post(url, body, options);
      console.log('✅ Generation request successful!');
      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log('🤖 Response:', text);
    } catch (error) {
      console.log('❌ Generation request failed');
      if (error.response) {
        console.log('Status:', error.response.status);
        console.log('Error details:', JSON.stringify(error.response.data, null, 2));
        
        // Check for specific error types
        if (error.response.status === 429) {
          console.log('\n🚨 RATE LIMIT ERROR DETECTED');
          console.log('This means you have exceeded the rate limits for your API key.');
          console.log('\nPossible causes:');
          console.log('1. You have made too many requests recently (free tier: 15/min)');
          console.log('2. Your API key is associated with a project that has billing issues');
          console.log('3. The API key is not properly configured for the Gemini API');
          console.log('4. You might be using a different project than you think');
          
          console.log('\n🔧 Solutions to try:');
          console.log('1. Wait 1-2 minutes and try again');
          console.log('2. Check your Google Cloud Console billing');
          console.log('3. Verify the Gemini API is enabled for your project');
          console.log('4. Create a new API key in a different project');
        }
      }
    }
    
    // Test 3: Check API key format and try different models
    console.log('\n🔧 Test 3: API key validation...');
    console.log('API Key length:', geminiApiKey.length);
    console.log('API Key format:', geminiApiKey.startsWith('AIza') ? 'Valid format' : 'Unexpected format');
    
    // Try different models
    const models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'];
    for (const model of models) {
      console.log(`\n🧪 Testing model: ${model}`);
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const body = {
          contents: [
            { parts: [{ text: "Test" }] }
          ]
        };
        const options = {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        };
        if (geminiAgent) options.httpsAgent = geminiAgent;
        
        const response = await axios.post(url, body, options);
        console.log(`✅ ${model} works!`);
        break;
      } catch (error) {
        if (error.response?.status === 429) {
          console.log(`❌ ${model} - Rate limited`);
        } else {
          console.log(`❌ ${model} - ${error.response?.status || error.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testGeminiDetailed(); 