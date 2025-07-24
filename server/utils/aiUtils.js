
// Parse AI response and extract tools if any
function parseAiResponse(aiResponseText) {
  const text = aiResponseText.trim();

  // Try to extract JSON from code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*({[\s\S]*})\s*```/);
  let jsonStr = codeBlockMatch ? codeBlockMatch[1] : null;

  // If not found, try to find the first JSON object in the string
  if (!jsonStr) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const possibleJson = text.substring(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(possibleJson);
        if (Array.isArray(parsed.tools)) {
          return {
            tools: parsed.tools,
            message: parsed.message || aiResponseText,
            isJson: true
          };
        }
      } catch (e) {
        // Not valid JSON, fall through
      }
    }
  } else {
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.tools)) {
        return {
          tools: parsed.tools,
          message: parsed.message || aiResponseText,
          isJson: true
        };
      }
    } catch (e) {
      // Not valid JSON, fall through
    }
  }

  // Not a tool call, treat as plain text
  return {
    tools: [],
    message: aiResponseText,
    isJson: false
  };
}

// Generic tool processor
const processTool = async (tool, parameters, sessionId, oauth2Client, toolHandlers) => {
  const toolConfig = toolHandlers[tool];

  if (!toolConfig) {
    // This should not happen since the AI knows what tools are available
    console.error(`❌ [SERVER] Unknown tool requested: ${tool}`);
    return {
      success: false,
      message: `Unknown tool: ${tool}`,
      requiresConfirmation: false
    };
  }

  try {
    const result = await toolConfig.handler(parameters, sessionId, oauth2Client);

    // Ensure requiresConfirmation is set from tool config
    return {
      ...result,
      requiresConfirmation: toolConfig.requiresConfirmation || false
    };
  } catch (error) {
    console.error(`❌ [SERVER] Tool ${tool} failed:`, error);
    return {
      success: false,
      message: `Failed to ${tool}: ${error.message}`,
      requiresConfirmation: false
    };
  }
};

module.exports = {
  parseAiResponse,
  processTool
}; 