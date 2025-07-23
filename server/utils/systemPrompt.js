// Generate global system prompt for AI assistant
function generateGlobalSystemPrompt(userTimezone = 'UTC', toolHandlers = {}) {
  const currentTimeInUserTZ = new Date().toLocaleString('en-US', { timeZone: userTimezone });
  // Inline the tool parameter prompt logic here
  let out = 'TOOLS:';
  for (const [tool, def] of Object.entries(toolHandlers)) {
    out += `\n- ${tool}: ${def.description}`;
    if (def.parameters) {
      out += '\n  Input parameters:';
      for (const [param, meta] of Object.entries(def.parameters)) {
        if (meta.fields) {
          out += `\n    ${param} (object${meta.required ? ', required' : ''}):`;
          for (const [field, fmeta] of Object.entries(meta.fields)) {
            out += `\n      - ${field} (${fmeta.required ? 'required' : 'optional'}): ${fmeta.desc}`;
          }
        } else {
          out += `\n    ${param} (${meta.required ? 'required' : 'optional'}): ${meta.desc}`;
        }
      }
    }
    if (def.returns) {
      out += '\n  Returns:';
      for (const [field, meta] of Object.entries(def.returns)) {
        out += `\n    ${field}: ${meta.desc}`;
      }
    }
  }
  const finalToolPrompt = out;

  return `You are Vibe, a friendly personal assistant. Respond in the same language as the user. Apart from your own knowledge, you have access to the following tools to serve the user:

AVAILABLE TOOLS:
${finalToolPrompt}

TOOL CALLING FORMAT:
  {
    "tools": [
      { "tool": "tool_name", "parameters": { ... } }
    ],
    "message": "your natural language reply"
  }

CRITICAL RULES:
- If you call tools, your entire response text should be a JSON object as described above. No natural language outside the JSON object allowed!
- When you see "TOOL_RESULTS:" messages, these contain results from tools you previously called. Use this information naturally in your responses, but NEVER mention "tool output", "tool results", or reference the technical JSON format to users.

CONTEXT:
User timezone: ${userTimezone}
Current time: ${currentTimeInUserTZ}`;
}

module.exports = {
  generateGlobalSystemPrompt
}; 