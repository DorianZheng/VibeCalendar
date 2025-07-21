const { GoogleGenAI } = require('@google/genai');
const HttpsProxyAgent = require('https-proxy-agent');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function testGeminiWithProxy() {
  console.log('🧪 Testing Gemini API with proxy configuration...\n');
  
  // Check environment variables
  const proxyConfig = {
    http: process.env.HTTP_PROXY || process.env.http_proxy,
    https: process.env.HTTPS_PROXY || process.env.https_proxy,
    no_proxy: process.env.NO_PROXY || process.env.no_proxy
  };
  
  console.log('📋 Environment Configuration:');
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`  HTTPS_PROXY: ${proxyConfig.https || '❌ Not set'}`);
  console.log(`  HTTP_PROXY: ${proxyConfig.http || '❌ Not set'}`);
  console.log(`  NO_PROXY: ${proxyConfig.no_proxy || '❌ Not set'}`);
  console.log('');
  
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is required. Please set it in your .env file.');
    return;
  }
  
  // Test without proxy first
  console.log('🔄 Testing without proxy...');
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro", // Using primary model from global config
      contents: "Hello"
    });
    
    console.log('✅ Success without proxy!');
    console.log(`   Response: ${response.text.substring(0, 50)}...`);
  } catch (error) {
    console.log('❌ Failed without proxy:', error.message);
    
    // Test with proxy if available
    if (proxyConfig.https) {
      console.log('\n🔄 Testing with HTTPS proxy...');
      try {
        // Configure global fetch to use proxy
        let HttpsProxyAgentCtor = HttpsProxyAgent.HttpsProxyAgent || HttpsProxyAgent;
        const agent = new HttpsProxyAgentCtor(proxyConfig.https);
        const originalFetch = global.fetch;
        global.fetch = (url, options = {}) => {
          return originalFetch(url, {
            ...options,
            agent: agent
          });
        };
        
        const aiWithProxy = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY
        });
        
        const response = await aiWithProxy.models.generateContent({
          model: "gemini-2.5-pro", // Using primary model from global config
          contents: "Hello"
        });
        
        console.log('✅ Success with proxy!');
        console.log(`   Response: ${response.text.substring(0, 50)}...`);
        console.log(`   Proxy used: ${proxyConfig.https}`);
        
        // Restore original fetch
        global.fetch = originalFetch;
      } catch (proxyError) {
        console.log('❌ Failed with proxy:', proxyError.message);
        console.log('\n💡 Suggestions:');
        console.log('   1. Check if your proxy server is running');
        console.log('   2. Verify the proxy URL format (http://host:port)');
        console.log('   3. Check if proxy requires authentication');
        console.log('   4. Try different proxy servers');
        console.log('   5. Check if proxy supports HTTPS traffic');
      }
    } else {
      console.log('\n💡 Suggestions:');
      console.log('   1. Set HTTPS_PROXY in your .env file');
      console.log('   2. Example: HTTPS_PROXY=http://proxy-server:8080');
      console.log('   3. Check your network/firewall settings');
      console.log('   4. Try using a VPN');
    }
  }
}

// Run the test
testGeminiWithProxy().catch(console.error); 