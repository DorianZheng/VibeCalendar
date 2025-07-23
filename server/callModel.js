const { GLOBAL_MODEL_CONFIG, geminiGenerateContent, compactConversationHistory, sessions, saveSessions } = require('.');

// Unified model call function with automatic model switching

async function callModel({
  model, conversationHistory = [], currentMessage, systemPrompt = null, sessionId = null, options = {}
}) {
  const {
    maxRetries = 3, baseDelay = 1000, enableModelSwitching = true, enableCompaction = true, timeout = 25000
  } = options;

  // Get the model to use (session model or provided model)
  let currentModel = model;
  if (sessionId) {
    // Use getCurrentModel for consistency if sessionId is provided
    currentModel = GLOBAL_MODEL_CONFIG.getCurrentModel(sessionId);
  }

  // Ensure we have a valid model
  if (!currentModel) {
    currentModel = GLOBAL_MODEL_CONFIG.primaryModel;
  }

  try {
    // Use the existing geminiGenerateContent function
    const result = await geminiGenerateContent({
      model: currentModel,
      conversationHistory,
      currentMessage,
      systemPrompt,
      sessionId,
      retryCount: 0,
      fallbackAttempt: 0
    });

    return {
      success: true,
      data: result,
      model: currentModel,
      switched: false
    };

  } catch (error) {

    // If model switching is disabled, throw the error
    if (!enableModelSwitching) {
      throw error;
    }

    // Try model switching
    const fallbacks = GLOBAL_MODEL_CONFIG.fallbackModels;
    const currentModelIndex = fallbacks.indexOf(currentModel);
    const availableFallbacks = fallbacks.slice(currentModelIndex + 1);

    if (availableFallbacks.length === 0) {
      console.error('❌ [SERVER] No fallback models available');
      throw error;
    }

    // Try each fallback model
    for (let i = 0; i < availableFallbacks.length; i++) {
      const fallbackModel = availableFallbacks[i];

      try {
        console.log(`🔄 [SERVER] Trying fallback model ${i + 1}/${availableFallbacks.length}: ${fallbackModel}`);

        // Apply compaction if enabled and conversation is large
        let optimizedHistory = conversationHistory;
        if (enableCompaction && conversationHistory.length > 10) {
          optimizedHistory = await compactConversationHistory(conversationHistory, {
            useAI: true,
            model: fallbackModel,
            sessionId: sessionId
          });
        }

        const result = await geminiGenerateContent({
          model: fallbackModel,
          conversationHistory: optimizedHistory,
          currentMessage,
          systemPrompt,
          sessionId,
          retryCount: 0,
          fallbackAttempt: 0
        });

        // Update session's preferred model
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          session.preferredModel = fallbackModel;
          sessions.set(sessionId, session);
          await saveSessions();
          console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${fallbackModel}`);
        }

        console.log(`✅ [SERVER] Model switch successful: ${currentModel} → ${fallbackModel}`);

        return {
          success: true,
          data: result,
          model: fallbackModel,
          switched: true,
          originalModel: currentModel
        };

      } catch (fallbackError) {
        console.error(`❌ [SERVER] Fallback model ${fallbackModel} failed:`, fallbackError.message);

        // If this is the last fallback, throw the original error
        if (i === availableFallbacks.length - 1) {
          throw error;
        }
      }
    }

    // If we get here, all fallbacks failed
    throw error;
  }
}
exports.callModel = callModel;
