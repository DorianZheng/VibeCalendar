
// Generate global system prompt for AI assistant
function generateGlobalSystemPrompt(userTimezone = 'UTC', toolHandlers = {}) {
  const currentTimeInUserTZ = new Date().toLocaleString('en-US', { timeZone: userTimezone });
  // Inline the tool parameter prompt logic here
  let toolPrompt = 'AVAILABLE TOOLS:';
  for (const [tool, def] of Object.entries(toolHandlers)) {
    toolPrompt += `\n- ${tool}: ${def.description}`;
    if (def.parameters) {
      toolPrompt += '\n  Input parameters:';
      for (const [param, meta] of Object.entries(def.parameters)) {
        if (meta.fields) {
          toolPrompt += `\n    ${param} (object${meta.required ? ', required' : ''}):`;
          for (const [field, fmeta] of Object.entries(meta.fields)) {
            toolPrompt += `\n      - ${field} (${fmeta.required ? 'required' : 'optional'}): ${fmeta.desc}`;
          }
        } else {
          toolPrompt += `\n    ${param} (${meta.required ? 'required' : 'optional'}): ${meta.desc}`;
        }
      }
    }
    if (def.returns) {
      toolPrompt += '\n  Returns:';
      for (const [field, meta] of Object.entries(def.returns)) {
        toolPrompt += `\n    ${field}: ${meta.desc}`;
      }
    }
  }

  systemPrompt = `You are Vibe, a friendly personal assistant. Respond in the same language as the user. Apart from your own knowledge, you have access to the following tools to serve the user:

${toolPrompt}

Your entire response text is a valid JSON object with the following format:
{
  "tools": [
    { "tool": "tool_name", "parameters": { ... } }
  ],
  "message": "your natural language reply"
}

CRITICAL RULES:
- Always respond in JSON format.
- Always respond in the same language as the user in the "message" field.
- When you see "TOOL_RESULTS:" messages, these contain results from tools you previously called. Use this information naturally in your responses, but NEVER mention "tool output", "tool results", or reference the technical JSON format to users.

CONTEXT:
User timezone: ${userTimezone}
Current time: ${currentTimeInUserTZ}`;

  return systemPrompt;
}

module.exports = {
  generateGlobalSystemPrompt
}; 
