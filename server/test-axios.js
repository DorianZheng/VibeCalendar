const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');

const proxy = 'http://127.0.0.1:7890';
// Support both old and new versions of https-proxy-agent
const HttpsProxyAgentCtor = HttpsProxyAgent.HttpsProxyAgent || HttpsProxyAgent;
const agent = new HttpsProxyAgentCtor(proxy);

console.log('🧪 Testing axios with proxy...');
console.log(`Proxy: ${proxy}`);

axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
  httpsAgent: agent,
  timeout: 10000
})
.then(response => {
  console.log('✅ Response status:', response.status);
  console.log('✅ Response body:', JSON.stringify(response.data).substring(0, 200) + '...');
})
.catch(error => {
  console.error('❌ Axios failed:', error.message);
  if (error.response) {
    console.error('Response status:', error.response.status);
    console.error('Response data:', error.response.data);
  }
}); 