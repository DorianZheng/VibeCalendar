// Estimate token count for conversation history
function estimateTokenCount(messages) {
  // Simple token estimation based on character count (rough approximation)
  return messages.reduce((sum, msg) => {
    const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + (contentStr?.length || 0) / 4; // Rough estimate: 4 chars per token
  }, 0);
}

// Unified conversation history compaction utility with AI fallback
async function compactConversationHistory(conversationHistory, options = {}) {
  // Hard Gemini API limits (tokens/chars)
  const HARD_CHAR_LIMIT = 30000;
  const HARD_TOKEN_LIMIT = 8000;
  const SAFE_CHAR_LIMIT = 0.9 * HARD_CHAR_LIMIT;
  const SAFE_TOKEN_LIMIT = 0.9 * HARD_TOKEN_LIMIT;

  // Find all pinned or important messages
  const pinnedMessages = conversationHistory.filter(msg => msg.pinned || msg.important);

  // Always preserve pinned/important and recent N messages
  const preserveRecent = options.preserveRecent || 12;
  const recentMessages = conversationHistory.slice(-preserveRecent);

  // Build initial preserved set
  let preserved = [];
  pinnedMessages.forEach(msg => {
    if (!preserved.includes(msg)) preserved.push(msg);
  });
  recentMessages.forEach(msg => {
    if (!preserved.includes(msg)) preserved.push(msg);
  });

  // Remove duplicates
  const seen = new Set();
  preserved = preserved.filter(msg => {
    // Use role + content hash for deduplication
    const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const key = `${msg.role}:${contentStr.substring(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // If under safe limits, return full history
  const totalChars = conversationHistory.reduce((sum, msg) => {
    const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + (contentStr?.length || 0);
  }, 0);
  const totalTokens = estimateTokenCount(conversationHistory);
  if (totalChars < SAFE_CHAR_LIMIT && totalTokens < SAFE_TOKEN_LIMIT) {
    return conversationHistory;
  }

  // If over limits, prefer AI-assisted compaction when available and enabled
  if (options.useAI !== false && options.model && options.sessionId) {
    console.log('🤖 [SERVER] Context too large, attempting AI-assisted compaction...');

    try {
      const compactPrompt = `The following conversation history is too long for the AI model to process efficiently.

Please summarize or compact the conversation, preserving all important user requests, assistant responses, and any context needed for future scheduling or actions.

Output the compacted conversation as a JSON array of messages, each with a role ('user' or 'model') and content. Do not include any explanation or extra text.`;

      const compactInput = [
        { role: 'user', content: compactPrompt },
        ...conversationHistory
      ];

      const modelResult = await callModel({
        model: options.model,
        conversationHistory: compactInput,
        currentMessage: '',
        sessionId: options.sessionId,
        options: {
          enableModelSwitching: true,
          enableCompaction: false // No need for compaction during compaction
        }
      });
      const response = modelResult.data;

      const aiText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Try to parse JSON array from AI response with robust parsing
      let aiCompactedHistory = null;
      try {
        // First, try to extract JSON array from the response
        const jsonArrayMatch = aiText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonArrayMatch) {
          aiCompactedHistory = JSON.parse(jsonArrayMatch[0]);
        } else {
          // Try to find any JSON structure
          const jsonMatch = aiText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            // If it's an object, try to extract messages array
            if (typeof parsed === 'object' && !Array.isArray(parsed)) {
              aiCompactedHistory = parsed.messages || parsed.conversation || parsed.history;
            } else if (Array.isArray(parsed)) {
              aiCompactedHistory = parsed;
            }
          } else {
            // Last resort: try to parse the entire text
            aiCompactedHistory = JSON.parse(aiText);
          }
        }

        // Validate that the parsed result is a valid conversation history
        if (!Array.isArray(aiCompactedHistory) || aiCompactedHistory.length === 0) {
          throw new Error('AI response is not a valid conversation history array');
        }

        // Validate each message has required fields
        const validMessages = aiCompactedHistory.filter(msg =>
          msg && typeof msg === 'object' &&
          (msg.role === 'user' || msg.role === 'model') &&
          msg.content
        );

        if (validMessages.length === 0) {
          throw new Error('No valid messages found in AI response');
        }

        aiCompactedHistory = validMessages;

        const aiCompactedChars = aiCompactedHistory.reduce((sum, m) => {
          const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return sum + (contentStr?.length || 0);
        }, 0);
        const aiCompactedTokens = estimateTokenCount(aiCompactedHistory);

        console.log('✅ [SERVER] AI-assisted compaction successful:', {
          originalLength: conversationHistory.length,
          aiCompactedLength: aiCompactedHistory.length,
          originalChars: totalChars,
          aiCompactedChars: aiCompactedChars,
          originalTokens: totalTokens,
          aiCompactedTokens: aiCompactedTokens,
          pinnedCount: pinnedMessages.length
        });

        return aiCompactedHistory;
      } catch (err) {
        console.error('❌ [SERVER] Failed to parse AI-compacted history:', {
          error: err.message,
          errorType: err.constructor.name,
          aiTextLength: aiText.length,
          aiTextPreview: aiText.substring(0, 500) + '...',
          fullAiText: aiText
        });
        // Fall back to traditional compaction
      }
    } catch (err) {
      console.error('❌ [SERVER] AI-assisted compaction failed:', err);
      // Fall back to traditional compaction
    }
  }

  // Fall back to traditional compaction if AI fails or is disabled
  const compactedChars = preserved.reduce((sum, m) => {
    const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + (contentStr?.length || 0);
  }, 0);
  const compactedTokens = estimateTokenCount(preserved);

  // Only log when actual compaction occurs (reduced size)
  if (preserved.length < conversationHistory.length) {
    console.log('📝 [SERVER] Using traditional compaction (AI failed or disabled):', {
      originalLength: conversationHistory.length,
      compactedLength: preserved.length,
      originalChars: totalChars,
      compactedChars: compactedChars,
      originalTokens: totalTokens,
      compactedTokens: compactedTokens,
      pinnedCount: pinnedMessages.length
    });
  }

  return preserved;
}

module.exports = {
  estimateTokenCount,
  compactConversationHistory
}; 