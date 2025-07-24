const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const { compactConversationHistory } = require('./conversationUtils');

// Configure Gemini API variables
const geminiProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiAgent = geminiProxy ? new (HttpsProxyAgent.HttpsProxyAgent || HttpsProxyAgent)(geminiProxy) : undefined;

const GLOBAL_MODEL_CONFIG = {
  // Primary model to use for all AI operations (using faster model for better performance)
  primaryModel: 'gemini-2.5-pro',

  // Fallback models in order of preference (prioritizing faster models)
  fallbackModels: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-pro',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest'
  ],

  allModels: [],
  modelStatus: {},

  // Update configuration based on available models from API
  updateFromAvailableModels: (availableModels) => {
    if (!availableModels || availableModels.length === 0) {
      console.log('⚠️ [SERVER] No available models provided, keeping current configuration');
      return;
    }

    // Extract model names (remove 'models/' prefix)
    const modelNames = availableModels.map(m => m.name.replace('models/', ''));

    // Update fallback models to only include available ones
    const availableFallbacks = GLOBAL_MODEL_CONFIG.fallbackModels.filter(model =>
      modelNames.includes(model)
    );

    // If primary model is not available, use first available model
    let newPrimaryModel = GLOBAL_MODEL_CONFIG.primaryModel;
    if (!modelNames.includes(GLOBAL_MODEL_CONFIG.primaryModel)) {
      newPrimaryModel = modelNames[0];
      console.log(`⚠️ [SERVER] Primary model ${GLOBAL_MODEL_CONFIG.primaryModel} not available, switching to ${newPrimaryModel}`);
    }

    // Update configuration
    GLOBAL_MODEL_CONFIG.primaryModel = newPrimaryModel;
    GLOBAL_MODEL_CONFIG.fallbackModels = availableFallbacks;

    GLOBAL_MODEL_CONFIG.allModels = [GLOBAL_MODEL_CONFIG.primaryModel, ...GLOBAL_MODEL_CONFIG.fallbackModels];

    GLOBAL_MODEL_CONFIG.allModels.forEach(model => {
      GLOBAL_MODEL_CONFIG.modelStatus[model] = { available: true, lastError: null, errorCount: 0 };
    });

    console.log(`✅ [SERVER] Updated global model configuration: ${GLOBAL_MODEL_CONFIG.allModels.join(', ')}`);
  }
};

function getModelStatus() {
  return GLOBAL_MODEL_CONFIG.modelStatus;
}

async function geminiGenerateContent({
  model,
  conversationHistory = [],
  currentMessage,
  systemPrompt = null,
  requestId = null,
  enableModelSwitching = true,
  enableCompaction = true
}) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  const startTime = Date.now();

  // Build the list of models to try: primary first, then fallbacks
  const modelsToTry = [model, ...GLOBAL_MODEL_CONFIG.fallbackModels.filter(m => m !== model)];

  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
    const tryModel = modelsToTry[modelIdx];
    let lastError = null;
    let usedCompaction = false;
    for (let retry = 0; retry < maxRetries; retry++) {
      // For fallbacks, compact history if enabled
      let history = conversationHistory;
      if (enableCompaction && modelIdx > 0 && conversationHistory.length > 10) {
        history = await compactConversationHistory(conversationHistory, {
          useAI: true,
          model: tryModel
        });
        usedCompaction = true;
      }

      // Build request
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${geminiApiKey}`;
      const contents = [
        ...(systemPrompt ? [{ role: 'user', parts: [{ text: systemPrompt }] }] : []),
        ...(history || []).map(msg => ({
          role: msg.role,
          parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
        })),
        { role: 'user', parts: [{ text: currentMessage || '' }] }
      ];
      const body = { contents };
      const options = {
        headers: { 'Content-Type': 'application/json' },
        timeout: modelIdx > 0 ? 20000 : 30000
      };
      if (geminiAgent) options.httpsAgent = geminiAgent;

      try {
        const response = await axios.post(url, body, options);
        return {
          success: true,
          data: response.data,
          model: tryModel,
          switched: modelIdx > 0,
          fallbackModel: modelIdx > 0 ? tryModel : null,
          originalModel: model
        };
      } catch (error) {
        lastError = error;
        // Retry on 5xx or network errors
        if ((error.response?.status >= 500 || error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') && retry < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, retry); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // For 429/503, break and try next model
        if (error.response?.status === 429 || error.response?.status === 503) {
          break;
        }
      }
    }
    // If we get here, this model failed all retries, try next fallback
  }
  // If all models fail, throw the last error
  throw new Error('All Gemini models failed to generate content.');
}

module.exports = {
  geminiGenerateContent,
  getModelStatus,
}; 
