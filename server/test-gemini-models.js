const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

console.log('🚀 Script starting...');
console.log('🔑 API Key present:', !!process.env.GEMINI_API_KEY);

async function listAndTestModels() {
  console.log('📞 Function called...');
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error('❌ GEMINI_API_KEY not found in environment variables');
      return;
    }

    console.log('🤖 Testing Google Gemini API Models...');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ GoogleGenerativeAI instance created');
    
    // Get available models
    console.log('\n📋 Fetching available models...');
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + process.env.GEMINI_API_KEY);
    const data = await response.json();
    
    if (!data.models) {
      console.log('❌ No models found in API response');
      console.log('Response:', JSON.stringify(data, null, 2));
      return;
    }
    
    console.log('✅ Successfully listed models via direct API:');
    data.models.forEach(model => {
      console.log(`  - ${model.name} (${model.displayName || 'No display name'})`);
      if (model.supportedGenerationMethods) {
        console.log(`    Supported methods: ${model.supportedGenerationMethods.join(', ')}`);
      }
    });
    
    // Filter models that support generateContent
    const availableModels = data.models.filter(model => 
      model.supportedGenerationMethods && 
      model.supportedGenerationMethods.includes('generateContent')
    );
    
    console.log(`\n🧪 Testing ${availableModels.length} models that support generateContent...`);
    
    const workingModels = [];
    const failedModels = [];
    
    for (const model of availableModels) {
      try {
        console.log(`\n🔍 Testing ${model.name}...`);
        const genModel = genAI.getGenerativeModel({ model: model.name });
        
        const prompt = "Hello, can you respond with a simple 'Hello from [model-name]' message?";
        
        const result = await genModel.generateContent(prompt);
        const response = result.response.text();
        
        console.log(`✅ ${model.name} - SUCCESS`);
        console.log(`   Response: ${response.substring(0, 100)}...`);
        workingModels.push(model.name);
        
      } catch (error) {
        console.log(`❌ ${model.name} - FAILED: ${error.message}`);
        failedModels.push({ name: model.name, error: error.message });
      }
    }
    
    // Summary
    console.log('\n📊 TESTING SUMMARY:');
    console.log(`✅ Working models (${workingModels.length}):`);
    workingModels.forEach(model => console.log(`  - ${model}`));
    
    console.log(`\n❌ Failed models (${failedModels.length}):`);
    failedModels.forEach(model => console.log(`  - ${model.name}: ${model.error}`));
    
    // Recommend models for fallback
    console.log('\n💡 RECOMMENDED FALLBACK MODELS:');
    const recommendedModels = workingModels.filter(model => 
      model.includes('gemini-1.5') || 
      model.includes('gemini-2.0') || 
      model.includes('gemini-2.5')
    );
    
    if (recommendedModels.length > 0) {
      console.log('Primary models (recommended for fallback):');
      recommendedModels.forEach(model => console.log(`  - ${model}`));
    }
    
    const alternativeModels = workingModels.filter(model => 
      !model.includes('gemini-1.5') && 
      !model.includes('gemini-2.0') && 
      !model.includes('gemini-2.5')
    );
    
    if (alternativeModels.length > 0) {
      console.log('\nAlternative models:');
      alternativeModels.forEach(model => console.log(`  - ${model}`));
    }
    
  } catch (error) {
    console.error('❌ Error testing Gemini API:', error.message);
    console.error('Full error:', error);
  }
}

console.log('📞 Calling function...');
listAndTestModels().then(() => {
  console.log('✅ Script completed');
}).catch(error => {
  console.error('❌ Script failed:', error);
}); 