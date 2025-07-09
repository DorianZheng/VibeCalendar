const { HttpsProxyAgent } = require('https-proxy-agent');

const proxy = 'http://127.0.0.1:7890';
const agent = new HttpsProxyAgent(proxy);

console.log('🧪 Testing Node.js fetch with proxy...');
console.log(`Proxy: ${proxy}`);

fetch('https://generativelanguage.googleapis.com/v1beta/models', { agent })
  .then(res => {
    console.log('✅ Response status:', res.status);
    return res.text();
  })
  .then(text => {
    console.log('✅ Response body:', text.substring(0, 200) + '...');
  })
  .catch(error => {
    console.error('❌ Fetch failed:', error.message);
  }); 