const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const fs = require('fs').promises;
const path = require('path');
const requestLogger = require('./middleware/requestLogger');
const { logExternalError, generateExternalRequestId } = require('./utils/externalApiLogger');

// Load environment variables
dotenv.config();

// Global model configuration - single source of truth for all model selections
const GLOBAL_MODEL_CONFIG = {
  // Primary model to use for all AI operations (using faster model for better performance)
  // primaryModel: 'gemini-2.5-flash',
  primaryModel: 'gemini-2.5-pro',

  // Fallback models in order of preference (prioritizing faster models)
  fallbackModels: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite-001',
  ],

  // Get the current model to use (can be overridden by session preferences)
  getCurrentModel: (sessionId = null) => {
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      return session.preferredModel || GLOBAL_MODEL_CONFIG.primaryModel;
    }
    return GLOBAL_MODEL_CONFIG.primaryModel;
  },

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

    console.log(`✅ [SERVER] Updated global model configuration:`);
    console.log(`   Primary model: ${GLOBAL_MODEL_CONFIG.primaryModel}`);
    console.log(`   Available fallbacks: ${GLOBAL_MODEL_CONFIG.fallbackModels.length} models`);

    // Note: Session models will be updated reactively when API calls fail
  },

  // Session models are now updated reactively in geminiGenerateContent error handler

  // Force update all sessions to use current global model (for admin use)
  forceUpdateAllSessions: () => {
    let updatedSessions = 0;

    for (const [sessionId, session] of sessions.entries()) {
      if (session.preferredModel !== GLOBAL_MODEL_CONFIG.primaryModel) {
        const oldModel = session.preferredModel;
        session.preferredModel = GLOBAL_MODEL_CONFIG.primaryModel;
        updatedSessions++;

        console.log(`🔄 [SERVER] Force updated session ${sessionId.substring(0, 8)}... model: ${oldModel} → ${session.preferredModel}`);
      }
    }

    if (updatedSessions > 0) {
      console.log(`✅ [SERVER] Force updated ${updatedSessions} sessions to use current global model`);
      // Save sessions to persist the changes
      saveSessions().catch(err => {
        console.error('❌ [SERVER] Failed to save updated sessions:', err.message);
      });
    }

    return updatedSessions;
  }
};

// Tool handlers registry - easily extensible for future tools
const toolHandlers = {
  'create_event': {
    description: "Create a new event.",
    parameters: {
      event: {
        required: true,
        fields: {
          title: { required: true, desc: "Event title" },
          startTime: { required: true, desc: "Start time (ISO)" },
          endTime: { required: true, desc: "End time (ISO)" },
          description: { required: false, desc: "Event details" },
          location: { required: false, desc: "Event location" },
          attendees: { required: false, desc: "Attendee emails" },
          reminders: { required: false, desc: "Reminders" },
          timezone: { required: false, desc: "Timezone" }
        }
      }
    },
    returns: {
      success: { desc: "Tool success status" },
      event: { desc: "Created event data" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      // Support both nested event format and direct field format
      let event = parameters.event;

      // If no nested event, check if fields are directly in parameters
      if (!event) {
        const { title, startTime, endTime, description, location, attendees, reminders, timezone } = parameters;
        if (title && startTime && endTime) {
          event = { title, startTime, endTime, description, location, attendees, reminders, timezone };
        }
      }

      if (!event || !event.title || !event.startTime || !event.endTime) {
        throw new Error('Missing required event fields');
      }

      // Get user's timezone from the event or use UTC as fallback
      const userTimezone = event.timezone || 'UTC';

      const calendarEvent = {
        summary: event.title,
        description: event.description,
        start: {
          dateTime: event.startTime,
          timeZone: userTimezone,
        },
        end: {
          dateTime: event.endTime,
          timeZone: userTimezone,
        },
        location: event.location,
        attendees: event.attendees ? event.attendees.map(email => ({ email })) : [],
        reminders: {
          useDefault: false,
          overrides: event.reminders ? event.reminders.map(reminder => ({
            method: 'email',
            minutes: reminder === '15 minutes before' ? 15 : 60
          })) : []
        }
      };

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: calendarEvent,
        sendUpdates: 'all'
      });

      return {
        success: true,
        event: response.data,
        message: `Event "${event.title}" created successfully!`
      };
    },
    requiresConfirmation: false
  },

  'query_events': {
    description: "Access user's Google Calendar to view scheduled events and find available time slots.",
    parameters: {
      criteria: {
        required: true,
        fields: {
          startDate: { required: false, desc: "Start date (ISO)" },
          endDate: { required: false, desc: "End date (ISO)" },
          searchTerm: { required: false, desc: "Search keyword" }
        }
      }
    },
    returns: {
      success: { desc: "Tool success status" },
      events: { desc: "Found events array with IDs" },
      count: { desc: "Event count" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      // Handle both direct parameters and nested criteria format
      const { criteria = {} } = parameters;
      let { startDate, endDate, searchTerm } = criteria;

      // If not found in criteria, check direct parameters (AI often sends them this way)
      if (!startDate && parameters.startDate) startDate = parameters.startDate;
      if (!endDate && parameters.endDate) endDate = parameters.endDate;
      if (!searchTerm && parameters.searchTerm) searchTerm = parameters.searchTerm;

      // Validate and format dates
      let validStartDate, validEndDate;

      try {
        if (startDate) {
          validStartDate = new Date(startDate).toISOString();
        }
        if (endDate) {
          validEndDate = new Date(endDate).toISOString();
        }
      } catch (dateError) {
        console.error('❌ [SERVER] Invalid date format in query_events:', {
          startDate,
          endDate,
          error: dateError.message
        });
        return {
          success: false,
          message: 'Invalid date format provided. Please use ISO date format (YYYY-MM-DDTHH:mm:ss.sssZ).'
        };
      }

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Ensure proper date formatting for Google Calendar API
      const now = new Date();
      const defaultStartDate = validStartDate || now.toISOString();
      const defaultEndDate = validEndDate || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      console.log('🔍 [SERVER] Query events parameters:', {
        startDate: defaultStartDate,
        endDate: defaultEndDate,
        searchTerm: searchTerm || 'none',
        originalStartDate: startDate,
        originalEndDate: endDate
      });

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: defaultStartDate,
        timeMax: defaultEndDate,
        singleEvents: true,
        orderBy: 'startTime',
        q: searchTerm
      });

      const events = response.data.items || [];

      // Return events in original Google Calendar format to maintain compatibility
      const formattedEvents = events.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start,
        end: event.end,
        description: event.description,
        location: event.location,
        attendees: event.attendees,
        reminders: event.reminders
      }));

      return {
        success: true,
        events: formattedEvents,
        count: events.length,
        message: `Found ${events.length} events matching your criteria. Each event has an ID that can be used for deletion.`
      };
    },
    requiresConfirmation: false
  },

  'update_event': {
    description: "Update an existing event in the calendar.",
    parameters: {
      eventId: { required: true, desc: "ID of event to update" },
      event: {
        required: true,
        fields: {
          title: { required: false, desc: "New title" },
          startTime: { required: false, desc: "New start time (ISO)" },
          endTime: { required: false, desc: "New end time (ISO)" },
          description: { required: false, desc: "New details" },
          location: { required: false, desc: "New location" },
          attendees: { required: false, desc: "New attendee emails" },
          reminders: { required: false, desc: "New reminders" },
          timezone: { required: false, desc: "New timezone" }
        }
      }
    },
    returns: {
      success: { desc: "Tool success status" },
      event: { desc: "Updated event data" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      const { eventId, event } = parameters;
      if (!eventId || !event) {
        throw new Error('Missing event ID or event data');
      }

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // First, get the existing event to preserve required fields
      const existingEvent = await calendar.events.get({
        calendarId: 'primary',
        eventId: eventId
      });

      // Build update object by merging existing event with new data
      const calendarEvent = {
        ...existingEvent.data,
        summary: event.title || existingEvent.data.summary,
        description: event.description !== undefined ? event.description : existingEvent.data.description,
        location: event.location !== undefined ? event.location : existingEvent.data.location,
        attendees: event.attendees ? event.attendees.map(email => ({ email })) : existingEvent.data.attendees,
        reminders: event.reminders ? {
          useDefault: false,
          overrides: event.reminders.map(reminder => ({
            method: 'email',
            minutes: reminder === '15 minutes before' ? 15 : 60
          }))
        } : existingEvent.data.reminders
      };

      // Only update start/end times if both are provided
      if (event.startTime && event.endTime) {
        const userTimezone = event.timezone || 'UTC';
        calendarEvent.start = {
          dateTime: event.startTime,
          timeZone: userTimezone,
        };
        calendarEvent.end = {
          dateTime: event.endTime,
          timeZone: userTimezone,
        };
      }

      const response = await calendar.events.update({
        calendarId: 'primary',
        eventId: eventId,
        resource: calendarEvent,
        sendUpdates: 'all'
      });

      return {
        success: true,
        event: response.data,
        message: `Event "${event.title || response.data.summary || 'Unknown'}" updated successfully!`
      };
    },
    requiresConfirmation: true
  },

  'delete_event': {
    description: "Delete an event from the calendar.",
    parameters: {
      eventId: { required: true, desc: "ID of event to delete" },
      eventTitle: { required: false, desc: "Title of the event" }
    },
    returns: {
      success: { desc: "Tool success status" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      const { eventId, eventTitle } = parameters;
      if (!eventId) {
        throw new Error('Missing event ID');
      }

      console.log('🗑️ [SERVER] Deleting calendar event:', {
        eventId,
        eventTitle: eventTitle || 'Unknown',
        sessionId: sessionId.substring(0, 8) + '...'
      });

      try {
        // Enforce rate limiting before making API call
        await enforceCalendarRateLimit(sessionId, 'delete');

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        console.log('🌐 [SERVER] Making Google Calendar API call to delete event...', {
          sessionId: sessionId.substring(0, 8) + '...',
          calendarId: 'primary',
          eventId
        });

        // Retry logic for rate limiting with better backoff
        let retryCount = 0;
        const maxRetries = 5;
        const baseDelay = 2000; // 2 seconds base delay

        while (retryCount <= maxRetries) {
          try {
            await calendar.events.delete({
              calendarId: 'primary',
              eventId: eventId,
              sendUpdates: 'all'
            });
            break; // Success, exit retry loop
          } catch (error) {
            if (error.code === 429 && retryCount < maxRetries) {
              // Exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s
              const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
              console.log(`⏳ [SERVER] Rate limited, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              retryCount++;
            } else {
              throw error; // Re-throw if not a 429 error or max retries reached
            }
          }
        }

        console.log('✅ [SERVER] Google Calendar API event deleted:', {
          sessionId: sessionId.substring(0, 8) + '...',
          eventId,
          eventTitle: eventTitle || 'Unknown'
        });

        return {
          success: true,
          message: `Event "${eventTitle || 'Unknown'}" deleted successfully!`,
          eventId: eventId,
          eventTitle: eventTitle
        };

      } catch (error) {
        console.error('❌ [SERVER] Delete event error:', {
          error: error.message,
          status: error.code,
          sessionId: sessionId.substring(0, 8) + '...',
          eventId,
          eventTitle: eventTitle || 'Unknown'
        });

        // Handle specific error cases
        let errorMessage = 'Failed to delete calendar event';

        if (error.code === 410) {
          // Event was already deleted - this is actually a success case
          return {
            success: true,
            message: `Event "${eventTitle || 'Unknown'}" was already deleted`,
            eventId: eventId,
            eventTitle: eventTitle
          };
        } else if (error.code === 401) {
          errorMessage = 'Authentication failed - please reconnect your Google Calendar';
        } else if (error.code === 403) {
          errorMessage = 'Permission denied - check your Google Calendar permissions';
        } else if (error.code === 404) {
          errorMessage = 'Event not found - it may have been deleted already';
        } else if (error.code === 429) {
          errorMessage = 'Rate limit exceeded - please try again later';
        }

        return {
          success: false,
          message: errorMessage,
          error: error.message,
          eventId: eventId,
          eventTitle: eventTitle
        };
      }
    },
    requiresConfirmation: true  // Server-side only, AI doesn't see this
  }

  // Easy to add new tools here:
  // 'new_tool': {
  //   description: "Description of what this tool does",
  //   handler: async (parameters, sessionId, oauth2Client) => {
  //     // Implementation here
  //   },
  //   requiresConfirmation: false // or true if destructive
  // }
};

// Global rate limiting for calendar operations
const calendarRateLimiter = new Map(); // sessionId -> lastOperationTime

// Track pending confirmations and their SSE connections
const pendingConfirmations = new Map(); // sessionId -> { res, sendSSE, tools, aiResponse, currentConversationHistory }

// Helper function to continue SSE processing after confirmation
async function continueSSEAfterConfirmation(sessionId, updatedConversationHistory, toolResults, wasCancelled) {
  const pendingContext = pendingConfirmations.get(sessionId);
  if (!pendingContext) {
    console.error('❌ [SSE] No pending context found for session:', sessionId.substring(0, 8) + '...');
    return;
  }

  const { res, sendSSE, userSession } = pendingContext;

  try {
    // Update user session with new conversation history
    userSession.conversationHistory = updatedConversationHistory;
    sessions.set(sessionId, userSession);
    await saveSessions();

    if (wasCancelled) {
      // Handle cancellation with AI
      const userTimezone = userSession.timezone || 'UTC';
      const cancellationSystemPrompt = generateGlobalSystemPrompt(userTimezone);
      const cancellationResponse = await callModel({
        model: GLOBAL_MODEL_CONFIG.getCurrentModel(sessionId),
        conversationHistory: updatedConversationHistory,
        currentMessage: '',
        systemPrompt: cancellationSystemPrompt,
        sessionId: sessionId
      });

      const cancellationText = cancellationResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Operations cancelled.';
      const parsedCancellation = parseAiResponse(cancellationText);

      // Update conversation history with cancellation response
      userSession.conversationHistory = [
        ...updatedConversationHistory,
        { role: 'model', content: parsedCancellation.message, timestamp: new Date() }
      ];
      sessions.set(sessionId, userSession);
      await saveSessions();

      console.log('✅ [SSE] Sending cancellation message:', parsedCancellation.message.substring(0, 100) + '...');
      sendSSE({ type: 'final', message: parsedCancellation.message });
      res.end();
      return;
    }

    // Handle successful tool execution with AI summary
    const userTimezone = userSession.timezone || 'UTC';
    const summarySystemPrompt = generateGlobalSystemPrompt(userTimezone);
    const finalResponse = await callModel({
      model: GLOBAL_MODEL_CONFIG.getCurrentModel(sessionId),
      conversationHistory: updatedConversationHistory,
      currentMessage: '',
      systemPrompt: summarySystemPrompt,
      sessionId: sessionId
    });

    const finalText = finalResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Operations completed.';
    const parsedFinalResponse = parseAiResponse(finalText);

    // Update conversation history with final AI response
    userSession.conversationHistory = [
      ...updatedConversationHistory,
      { role: 'model', content: parsedFinalResponse.message, timestamp: new Date() }
    ];
    sessions.set(sessionId, userSession);
    await saveSessions();

    console.log('✅ [SSE] Sending final message:', parsedFinalResponse.message.substring(0, 100) + '...');
    sendSSE({ type: 'final', message: parsedFinalResponse.message });
    res.end();

  } catch (error) {
    console.error('❌ [SSE] Error continuing after confirmation:', error);
    sendSSE({ type: 'final', message: 'Sorry, an error occurred during processing.' });
    res.end();
  }
}

// Helper function to enforce rate limiting for calendar operations
const enforceCalendarRateLimit = async (sessionId, operationType = 'calendar') => {
  const now = Date.now();
  const lastOperation = calendarRateLimiter.get(sessionId);
  const minInterval = 1000; // 1 second minimum between operations

  if (lastOperation && (now - lastOperation) < minInterval) {
    const waitTime = minInterval - (now - lastOperation);
    console.log(`⏳ [SERVER] Rate limiting calendar operation for session ${sessionId.substring(0, 8)}..., waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  calendarRateLimiter.set(sessionId, Date.now());
};

// Generate global system prompt for AI assistant
function generateGlobalSystemPrompt(userTimezone = 'UTC') {
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
- To call a tool, respond with a JSON object in the following format:
  {
    "tools": [
      { "tool": "tool_name", "parameters": { ... } }
    ],
    "message": "your natural language reply"
  }

CRITICAL RULES:
- If you need to call a tool, respond with only the JSON object as described above. Do not put natural language outside the JSON object. Do not mix natural language with the JSON object.
- NEVER embed tool results like [{"success": true...}] in your natural language responses.
- When you see "TOOL_RESULTS:" messages, these contain results from tools you previously called. Use this information naturally in your responses, but NEVER mention "tool output", "tool results", or reference the technical JSON format to users.

CONTEXT:
User timezone: ${userTimezone}
Current time: ${currentTimeInUserTZ}`;
}

// Parse AI response and extract tools if any
function parseAiResponse(aiResponseText) {
  try {
    let cleanResponse = aiResponseText.trim();

    // Look for JSON in code blocks first
    const jsonMatch = cleanResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```$/);
    if (jsonMatch) {
      cleanResponse = jsonMatch[1];
    } else {
      // Only look for JSON if it looks like a tool calling response
      // (starts with { and contains "tools" array)
      const startsWithBrace = cleanResponse.startsWith('{');
      const endsWithBrace = cleanResponse.endsWith('}');
      const containsTools = cleanResponse.includes('"tools"');

      if (startsWithBrace && endsWithBrace && containsTools) {
        // This might be a tool calling response
        const lastBraceIndex = cleanResponse.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
          const firstBraceIndex = cleanResponse.indexOf('{');
          if (firstBraceIndex !== -1 && firstBraceIndex < lastBraceIndex) {
            cleanResponse = cleanResponse.substring(firstBraceIndex, lastBraceIndex + 1);
          }
        }
      } else {
        // This is plain text, not a tool calling response
        return {
          tools: [],
          message: aiResponseText,
          isJson: false
        };
      }
    }

    const parsed = JSON.parse(cleanResponse);

    // Only treat as valid tool response if it has tools array
    if (parsed.tools && Array.isArray(parsed.tools)) {
      return {
        tools: parsed.tools || [],
        message: parsed.message || aiResponseText,
        isJson: true
      };
    } else {
      // Not a valid tool response, treat as plain text
      return {
        tools: [],
        message: aiResponseText,
        isJson: false
      };
    }
  } catch (parseError) {
    return {
      tools: [],
      message: aiResponseText,
      isJson: false
    };
  }
}

// Generic tool processor
const processTool = async (tool, parameters, sessionId, oauth2Client) => {
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

const app = express();
const PORT = process.env.PORT || 50001;

// Trust proxy for rate limiting (fixes X-Forwarded-For header error)
app.set('trust proxy', 1);

// Add request logging middleware
app.use(requestLogger);

// Configure proxy settings for external API calls
const proxyConfig = {
  http: process.env.HTTP_PROXY || process.env.http_proxy,
  https: process.env.HTTPS_PROXY || process.env.https_proxy,
  no_proxy: process.env.NO_PROXY || process.env.no_proxy
};

// Log proxy configuration
if (proxyConfig.http || proxyConfig.https) {
  console.log('🌐 [SERVER] Proxy configuration detected:', {
    http: proxyConfig.http ? 'configured' : 'none',
    https: proxyConfig.https ? 'configured' : 'none',
    no_proxy: proxyConfig.no_proxy || 'none'
  });
} else {
  console.log('🌐 [SERVER] No proxy configuration found');
}

// Persistent session store
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const sessions = new Map();

// Load sessions from file on startup
const loadSessions = async () => {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf8');
    const sessionsData = JSON.parse(data);

    // Convert back to Map and validate tokens
    for (const [sessionId, sessionData] of Object.entries(sessionsData)) {
      // Check if tokens are still valid (not expired)
      if (sessionData.tokens && sessionData.tokens.expiry_date && sessionData.tokens.expiry_date > Date.now()) {
        sessions.set(sessionId, sessionData);
        console.log('✅ [SERVER] Loaded session:', sessionId.substring(0, 8) + '...');
      } else {
        console.log('⚠️ [SERVER] Skipped expired session:', sessionId.substring(0, 8) + '...');
      }
    }

    console.log(`📁 [SERVER] Loaded ${sessions.size} valid sessions from storage`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('📁 [SERVER] No existing sessions file found, starting fresh');
    } else {
      console.error('❌ [SERVER] Error loading sessions:', error.message);
    }
  }
};

// Save sessions to file
const saveSessions = async () => {
  try {
    const sessionsData = {};
    for (const [sessionId, sessionData] of sessions.entries()) {
      sessionsData[sessionId] = sessionData;
    }

    await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessionsData, null, 2));
    console.log(`💾 [SERVER] Saved ${sessions.size} sessions to storage`);
  } catch (error) {
    console.error('❌ [SERVER] Error saving sessions:', error.message);
  }
};

// Initialize sessions on startup
loadSessions();

// Token refresh function
const refreshTokenIfNeeded = async (sessionId, session) => {
  try {
    if (session.tokens.expiry_date && session.tokens.expiry_date <= Date.now() + 5 * 60 * 1000) { // 5 minutes before expiry
      console.log('🔄 [SERVER] Refreshing token for session:', sessionId.substring(0, 8) + '...');

      oauth2Client.setCredentials(session.tokens);
      const { credentials } = await oauth2Client.refreshAccessToken();

      session.tokens = credentials;
      sessions.set(sessionId, session);
      await saveSessions();

      console.log('✅ [SERVER] Token refreshed for session:', sessionId.substring(0, 8) + '...');
    }
  } catch (error) {
    console.error('❌ [SERVER] Token refresh failed for session:', sessionId.substring(0, 8) + '...', error.message);
    // Remove the session if refresh fails
    sessions.delete(sessionId);
    await saveSessions();
  }
};

// Cleanup expired sessions
const cleanupExpiredSessions = async () => {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [sessionId, session] of sessions.entries()) {
    if (session.tokens.expiry_date && session.tokens.expiry_date < now) {
      sessions.delete(sessionId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    await saveSessions();
    console.log(`🧹 [SERVER] Cleaned up ${cleanedCount} expired sessions`);
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Graceful shutdown handler
process.on('SIGINT', async () => {
  console.log('🛑 [SERVER] Shutting down gracefully...');
  await saveSessions();
  server.close(() => {
    console.log('✅ [SERVER] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('🛑 [SERVER] Shutting down gracefully...');
  await saveSessions();
  server.close(() => {
    console.log('✅ [SERVER] Server closed');
    process.exit(0);
  });
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting - more specific for different endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

const calendarLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5 // limit each IP to 5 calendar requests per minute
});

const calendarEventLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 3 // limit each IP to 3 event operations per 10 seconds
});

const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5 // limit each IP to 5 AI requests per minute
});

app.use(generalLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const geminiProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiAgent = geminiProxy ? new (HttpsProxyAgent.HttpsProxyAgent || HttpsProxyAgent)(geminiProxy) : undefined;

async function geminiGenerateContent({ model, conversationHistory = [], currentMessage, systemPrompt = null, retryCount = 0, fallbackAttempt = 0, sessionId = null, requestId = null }) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  const startTime = Date.now();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  // Build conversation contents
  const contents = [
    // Add system prompt if provided
    ...(systemPrompt ? [{
      role: 'user',
      parts: [{ text: systemPrompt }]
    }] : []),
    // Add conversation history
    ...(conversationHistory || []).map(msg => ({
      role: msg.role, // Gemini API supports 'user' and 'model' roles directly
      parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
    })),
    // Add current message
    {
      role: 'user',
      parts: [{ text: currentMessage || '' }]
    }
  ];

  const body = { contents };
  const options = {
    headers: { 'Content-Type': 'application/json' },
    timeout: fallbackAttempt > 0 ? 20000 : 30000 // 30s for primary, 20s for fallbacks
  };
  if (geminiAgent) options.httpsAgent = geminiAgent;

  // Log detailed request information (compact version)
  // Always show system prompt + last 4 entries to preserve system prompt visibility
  let recentContents;
  let hasMoreContents = false;
  
  if (contents.length <= 5) {
    // Show all contents if 5 or fewer
    recentContents = contents;
  } else {
    // Show system prompt (first entry) + last 4 entries
    const systemPromptEntry = contents[0];
    const lastFourEntries = contents.slice(-4);
    recentContents = [systemPromptEntry, ...lastFourEntries];
    hasMoreContents = contents.length > 5;
  }

  console.log('🤖 [GEMINI REQUEST]:', {
    requestId,
    model,
    sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
    url: url.replace(geminiApiKey, '***API_KEY***'),
    timeout: options.timeout,
    hasProxy: !!geminiAgent,
    retryCount,
    fallbackAttempt,
    requestBody: {
      contentsCount: contents.length,
      systemPromptLength: systemPrompt?.length || 0,
      conversationHistoryLength: conversationHistory?.length || 0,
      currentMessageLength: currentMessage?.length || 0,
      totalInputTokensEstimate: JSON.stringify(body).length
    },
    contentsSummary: recentContents.map((content, summaryIndex) => {
      // Find the actual index of this content in the original contents array
      let actualIndex;
      if (contents.length <= 5) {
        actualIndex = summaryIndex;
      } else {
        // First entry is system prompt (index 0), rest are from the end
        if (summaryIndex === 0) {
          actualIndex = 0; // System prompt
        } else {
          actualIndex = contents.length - 4 + (summaryIndex - 1); // Last 4 entries
        }
      }
      
      return {
        index: actualIndex,
        role: content.role,
        textLength: content.parts[0]?.text?.length || 0,
        textPreview: content.parts[0]?.text?.substring(0, 200) + (content.parts[0]?.text?.length > 200 ? '...' : ''),
        ...(hasMoreContents && summaryIndex === 1 ? { 
          note: `... ${contents.length - 5} entries omitted between system prompt and recent messages ...` 
        } : {})
      };
    }),
    timestamp: new Date().toISOString()
  });

  try {
    const response = await axios.post(url, body, options);
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Log detailed response information
    console.log('✅ [GEMINI RESPONSE]:', {
      requestId,
      model,
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      status: response.status,
      responseTime: `${responseTime}ms`,
      responseText: response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No text content',
      responseData: {
        candidates: response.data.candidates?.map((candidate, index) => ({
          index,
          finishReason: candidate.finishReason,
          contentLength: candidate.content?.parts?.[0]?.text?.length || 0,
          contentPreview: candidate.content?.parts?.[0]?.text?.substring(0, 200) + (candidate.content?.parts?.[0]?.text?.length > 200 ? '...' : ''),
          fullText: candidate.content?.parts?.[0]?.text || 'No text',
          safetyRatings: candidate.safetyRatings?.map(rating => ({
            category: rating.category,
            probability: rating.probability
          }))
        })),
        usageMetadata: response.data.usageMetadata,
        promptFeedback: response.data.promptFeedback
      },
      timestamp: new Date().toISOString()
    });

    // Mark model as available on success
    if (modelStatus[model]) {
      modelStatus[model].available = true;
      modelStatus[model].lastError = null;
    }

    return response.data;
  } catch (error) {
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Log external API error
    console.error('❌ [GEMINI ERROR]:', {
      requestId,
      model,
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseTime: `${responseTime}ms`,
      retryCount,
      fallbackAttempt,
      requestUrl: url.replace(geminiApiKey, '***API_KEY***'),
      requestBody: {
        contentsCount: contents.length,
        systemPromptLength: systemPrompt?.length || 0,
        conversationHistoryLength: conversationHistory?.length || 0,
        currentMessageLength: currentMessage?.length || 0,
        totalInputTokensEstimate: JSON.stringify(body).length
      },
      responseData: error.response?.data,
      hasProxy: !!geminiAgent,
      timestamp: new Date().toISOString()
    });

    // Model fallback configuration - using global config
    const modelFallbacks = {};

    // Create fallback mappings for all models using the global fallback list
    const allModels = [GLOBAL_MODEL_CONFIG.primaryModel, ...GLOBAL_MODEL_CONFIG.fallbackModels];
    allModels.forEach((currentModel, index) => {
      // Get remaining models as fallbacks
      const fallbacks = GLOBAL_MODEL_CONFIG.fallbackModels.slice(index);
      modelFallbacks[currentModel] = fallbacks;
    });

    console.log(`🔍 [SERVER] Model fallback configuration for ${model}:`, {
      model: model,
      fallbacks: modelFallbacks[model] || [],
      fallbackCount: (modelFallbacks[model] || []).length
    });

    // For 503 errors (service overload), switch to fallback models immediately instead of retrying
    if (error.response?.status === 503) {
      const fallbacks = modelFallbacks[model] || [];
      
      console.log(`🔄 [SERVER] Model ${model} is overloaded (503), switching to fallback models instead of retrying`);
      
      if (fallbackAttempt < fallbacks.length) {
        const nextModel = fallbacks[fallbackAttempt];
        console.log(`🔄 [SERVER] Switching from overloaded ${model} to fallback model: ${nextModel} (attempt ${fallbackAttempt + 1}/${fallbacks.length})`);
        
        // Update session's preferred model if sessionId is provided
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          session.preferredModel = nextModel;
          sessions.set(sessionId, session);
          await saveSessions();
          console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${nextModel} due to 503 overload`);
        }
        
        // Try with the next fallback model
        return geminiGenerateContent({
          model: nextModel,
          currentMessage,
          conversationHistory,
          systemPrompt, // Preserve system prompt
          retryCount: 0,
          fallbackAttempt: fallbackAttempt + 1,
          sessionId,
          requestId
        });
      } else {
        console.error(`❌ [SERVER] All fallback models exhausted for overloaded ${model}. No more models available.`);
      }
    }

    // Retry logic for other server errors (but preserve system prompt)
    if ((error.response?.status >= 500 || error.code === 'ECONNRESET') && retryCount < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff: 1s, 2s, 4s
      console.log(`🔄 [SERVER] Server error ${error.response?.status || error.code}, retrying with same model ${model} in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);

      await new Promise(resolve => setTimeout(resolve, delay));
      return geminiGenerateContent({ 
        model, 
        currentMessage, 
        conversationHistory, 
        systemPrompt, // Preserve system prompt
        retryCount: retryCount + 1, 
        fallbackAttempt,
        sessionId, 
        requestId 
      });
    }

    // Handle timeout errors by switching to faster models
    if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
      const fallbacks = modelFallbacks[model] || [];

      console.log(`⏰ [SERVER] Timeout detected for model ${model}, attempting to switch to faster model`);
      console.log(`🔍 [SERVER] Timeout fallback configuration:`, {
        model: model,
        fallbacksAvailable: fallbacks.length,
        fallbacks: fallbacks.slice(0, 3) // Show first 3 fallbacks
      });

      if (fallbackAttempt < fallbacks.length) {
        const nextModel = fallbacks[fallbackAttempt];
        console.log(`🔄 [SERVER] Switching from ${model} to faster model: ${nextModel} due to timeout (attempt ${fallbackAttempt + 1}/${fallbacks.length})`);
        console.log(`📝 [SERVER] Preserving conversation context: ${conversationHistory?.length || 0} messages`);

        // Update session's preferred model if sessionId is provided
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          if (session.preferredModel === model) {
            session.preferredModel = nextModel;
            sessions.set(sessionId, session);
            await saveSessions();
            console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${nextModel} due to timeout`);
          }
        }

        // Try with the next fallback model, using intelligent conversation history compaction
        const optimizedHistory = await compactConversationHistory(conversationHistory, {
          maxMessages: 6,
          maxTotalLength: 4000, // More aggressive for timeout recovery
          preserveSystemMessage: true,
          preserveRecentMessages: 4
        });

        return geminiGenerateContent({
          model: nextModel,
          currentMessage,
          conversationHistory: optimizedHistory,
          systemPrompt, // Preserve system prompt
          retryCount: 0,
          fallbackAttempt: fallbackAttempt + 1,
          sessionId,
          requestId
        });
      } else {
        console.error(`❌ [SERVER] All fallback models exhausted for timeout recovery. No more models available.`);
      }
    }

    // Update model status on error
    if (modelStatus[model]) {
      modelStatus[model].lastError = {
        status: error.response?.status,
        message: error.message,
        timestamp: new Date().toISOString()
      };
      modelStatus[model].errorCount++;

      // Mark model as temporarily unavailable if it hits rate limits
      if (error.response?.status === 429) {
        modelStatus[model].available = false;
        console.log(`⚠️ [SERVER] Model ${model} marked as temporarily unavailable due to rate limit`);
      }
    }

    // Update session's preferred model if the current model is not available (404, 403, etc.)
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      const isModelAvailabilityError = (
        error.response?.status === 404 ||
        error.response?.status === 403 ||
        (error.response?.data?.error?.message && error.response.data.error.message.includes('not found'))
      );

      // Don't update on 400 errors unless they're clearly model-related (not format issues)
      const isModelRelated400 = (
        error.response?.status === 400 &&
        error.response?.data?.error?.message &&
        (error.response.data.error.message.includes('not found') ||
          error.response.data.error.message.includes('model'))
      );

      const shouldUpdateModel = (
        session.preferredModel === model &&
        (isModelAvailabilityError || isModelRelated400)
      );

      if (shouldUpdateModel) {
        console.log(`🔄 [SERVER] Session ${sessionId.substring(0, 8)}... model ${model} failed (${error.response?.status}), updating to ${GLOBAL_MODEL_CONFIG.primaryModel}`);
        session.preferredModel = GLOBAL_MODEL_CONFIG.primaryModel;
        sessions.set(sessionId, session);
        await saveSessions();
        console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${GLOBAL_MODEL_CONFIG.primaryModel}`);
      }
    }

    // Switch models on 429 errors (rate limit) immediately without retrying same model
    if (error.response?.status === 429) {
      const fallbacks = modelFallbacks[model] || [];

      console.log(`🔍 [SERVER] Model switching debug:`, {
        model: model,
        errorStatus: error.response?.status,
        retryCount: retryCount,
        maxRetries: maxRetries,
        fallbackAttempt: fallbackAttempt,
        fallbacksAvailable: fallbacks.length,
        fallbacks: fallbacks
      });

      if (fallbackAttempt < fallbacks.length) {
        const nextModel = fallbacks[fallbackAttempt];
        console.log(`🔄 [SERVER] Model ${model} hit rate limit (429), switching to fallback model: ${nextModel} (attempt ${fallbackAttempt + 1}/${fallbacks.length})`);
        console.log(`📝 [SERVER] Preserving conversation context: ${conversationHistory?.length || 0} messages`);

        // Validate conversation history before switching models
        if (conversationHistory && conversationHistory.length > 0) {
          console.log(`✅ [SERVER] Conversation history validated: ${conversationHistory.length} messages preserved`);
          console.log(`📋 [SERVER] Conversation history details during model switch:`, {
            roles: conversationHistory.map(msg => msg.role),
            hasSystemMessage: conversationHistory.some(msg => msg.role === 'user' && msg.content.includes('AVAILABLE TOOLS')),
            systemMessagePreview: conversationHistory.find(msg => msg.role === 'user' && msg.content.includes('AVAILABLE TOOLS'))?.content.substring(0, 100) + '...'
          });
        } else {
          console.warn(`⚠️ [SERVER] Empty conversation history during model switch`);
        }

        // Update session's preferred model if sessionId is provided
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          session.preferredModel = nextModel;
          sessions.set(sessionId, session);
          await saveSessions();
          console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${nextModel}`);
        } else {
          console.warn(`⚠️ [SERVER] No sessionId provided or session not found for model switch`);
        }

        // Try with the next fallback model, using compaction for rate limit recovery
        const compactedHistory = await compactConversationHistory(conversationHistory, {
          maxMessages: 6,
          maxTotalLength: 4000, // More aggressive for rate limit recovery
          preserveSystemMessage: true,
          preserveRecentMessages: 4
        });

        return geminiGenerateContent({
          model: nextModel,
          currentMessage,
          conversationHistory: compactedHistory,
          systemPrompt, // Preserve system prompt
          retryCount: 0,
          fallbackAttempt: fallbackAttempt + 1,
          sessionId,
          requestId
        });
      } else {
        console.error(`❌ [SERVER] All fallback models exhausted for ${model}. No more models available.`);
      }
    }

    throw error;
  }
}

// Test Gemini API connection on startup
const testGeminiConnection = async () => {
  if (!geminiApiKey) {
    console.log('⚠️ [SERVER] Skipping Gemini API test - no API key configured');
    return;
  }

  try {
    console.log('🔄 [SERVER] Fetching available models from Gemini API...');

    // Fetch available models from Gemini API
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + geminiApiKey);
    const data = await response.json();

    if (!data.models) {
      console.error('❌ [SERVER] Failed to fetch models from Gemini API');
      return;
    }

    // Filter models that support generateContent
    const availableModels = data.models.filter(model =>
      model.supportedGenerationMethods &&
      model.supportedGenerationMethods.includes('generateContent')
    );

    console.log(`📋 [SERVER] Found ${availableModels.length} models that support generateContent`);

    // Update global configuration based on available models
    GLOBAL_MODEL_CONFIG.updateFromAvailableModels(availableModels);

    // Test the primary model first, then a few others
    const testModels = [
      GLOBAL_MODEL_CONFIG.primaryModel,
      ...availableModels.slice(0, 3).map(m => m.name.replace('models/', ''))
    ].filter((model, index, arr) => arr.indexOf(model) === index); // Remove duplicates

    console.log(`🧪 [SERVER] Testing ${testModels.length} models: ${testModels.join(', ')}`);

    for (const model of testModels) {
      try {
        console.log(`🔄 [SERVER] Testing Google Gemini API connection with model: ${model}...`);
        const modelResult = await callModel({
          model: model,
          currentMessage: 'Hello',
          options: {
            enableModelSwitching: false, // Disable switching for connection test
            enableCompaction: false
          }
        });
        const data = modelResult.data;
        if (data && data.candidates) {
          console.log(`✅ [SERVER] Google Gemini API connection successful with model: ${model}`);
          return; // Success, no need to test other models
        } else {
          console.log(`⚠️ [SERVER] Gemini API responded but no candidates in response for model: ${model}`);
        }
      } catch (error) {
        console.log(`❌ [SERVER] Model ${model} failed:`, error.response?.status || error.message);
        // Continue to next model
      }
    }

    console.error('❌ [SERVER] All tested Gemini models failed. Please check your GEMINI_API_KEY and internet connection');

  } catch (error) {
    console.error('❌ [SERVER] Failed to fetch models from Gemini API:', error.message);
    console.error('❌ [SERVER] Please check your GEMINI_API_KEY and internet connection');
  }
};

testGeminiConnection();

// Google Calendar API setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Store active watch subscriptions
const watchSubscriptions = new Map();

// Track model availability and performance - using global config
const modelStatus = {};

// Initialize model status for all models in global config
const allModels = [GLOBAL_MODEL_CONFIG.primaryModel, ...GLOBAL_MODEL_CONFIG.fallbackModels];
allModels.forEach(model => {
  modelStatus[model] = { available: true, lastError: null, errorCount: 0 };
});

// Google Calendar Watch API setup
const setupCalendarWatch = async (sessionId, oauth2Client) => {
  // Skip webhook setup in development mode (localhost)
  const isDevelopment = process.env.NODE_ENV === 'development' ||
    (process.env.CLIENT_URL && process.env.CLIENT_URL.includes('localhost'));

  if (isDevelopment) {
    console.log('⚠️ [SERVER] Skipping Google Calendar watch setup in development mode');
    return null;
  }

  try {
    console.log('🔄 [SERVER] Setting up Google Calendar watch for session:', sessionId.substring(0, 8) + '...');

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Create a unique webhook URL for this session
    const webhookUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/api/calendar/webhook/${sessionId}`;

    const watchRequest = {
      id: `vibe-calendar-${sessionId}`,
      type: 'web_hook',
      address: webhookUrl,
      params: {
        ttl: '604800' // 7 days in seconds
      }
    };

    const response = await calendar.events.watch({
      calendarId: 'primary',
      resource: watchRequest
    });

    // Store the subscription
    watchSubscriptions.set(sessionId, {
      subscriptionId: response.data.id,
      resourceId: response.data.resourceId,
      expiration: response.data.expiration,
      webhookUrl
    });

    console.log('✅ [SERVER] Google Calendar watch setup successful:', {
      sessionId: sessionId.substring(0, 8) + '...',
      subscriptionId: response.data.id,
      expiration: response.data.expiration
    });

    return response.data;
  } catch (error) {
    console.error('❌ [SERVER] Failed to setup Google Calendar watch:', {
      sessionId: sessionId.substring(0, 8) + '...',
      error: error.message,
      status: error.code
    });
    return null;
  }
};

// Stop watching calendar
const stopCalendarWatch = async (sessionId) => {
  try {
    const subscription = watchSubscriptions.get(sessionId);
    if (!subscription) {
      console.log('⚠️ [SERVER] No active watch subscription found for session:', sessionId.substring(0, 8) + '...');
      return;
    }

    console.log('🔄 [SERVER] Stopping Google Calendar watch for session:', sessionId.substring(0, 8) + '...');

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    await calendar.channels.stop({
      resource: {
        id: subscription.subscriptionId,
        resourceId: subscription.resourceId
      }
    });

    watchSubscriptions.delete(sessionId);

    console.log('✅ [SERVER] Google Calendar watch stopped successfully:', {
      sessionId: sessionId.substring(0, 8) + '...'
    });
  } catch (error) {
    console.error('❌ [SERVER] Failed to stop Google Calendar watch:', {
      sessionId: sessionId.substring(0, 8) + '...',
      error: error.message
    });
  }
};

// Authentication middleware
const requireAuth = async (req, res, next) => {
  const sessionId = req.headers['x-session-id'];

  if (!sessionId || !sessions.has(sessionId)) {
    console.log('❌ [SERVER] Authentication failed:', {
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      path: req.path,
      method: req.method
    });
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please connect your Google Calendar first'
    });
  }

  const session = sessions.get(sessionId);

  // Refresh token if needed
  await refreshTokenIfNeeded(sessionId, session);

  // Check if session still exists after potential refresh
  if (!sessions.has(sessionId)) {
    console.log('❌ [SERVER] Session expired during refresh:', {
      sessionId: sessionId.substring(0, 8) + '...',
      path: req.path,
      method: req.method
    });
    return res.status(401).json({
      error: 'Session expired',
      message: 'Please reconnect your Google Calendar'
    });
  }

  const updatedSession = sessions.get(sessionId);
  oauth2Client.setCredentials(updatedSession.tokens);
  req.session = updatedSession;
  next();
};

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'VibeCalendar API Server',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  console.log('🏥 [SERVER] Health check request:', {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  res.json({
    status: 'OK',
    message: 'VibeCalendar API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sessions: sessions.size,
    modelStatus: modelStatus
  });
});

// Force update session models endpoint (for testing)
app.post('/api/admin/update-session-models', (req, res) => {
  console.log('🔄 [SERVER] Manual session model update requested');
  GLOBAL_MODEL_CONFIG.forceUpdateAllSessions();
  res.json({
    success: true,
    message: 'Session models updated to use current global model',
    primaryModel: GLOBAL_MODEL_CONFIG.primaryModel
  });
});

// Session validation endpoint
app.get('/api/auth/session', async (req, res) => {
  const sessionId = req.headers['x-session-id'];

  console.log('🔍 [SERVER] Session validation request:', {
    sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
    ip: req.ip
  });

  if (!sessionId || !sessions.has(sessionId)) {
    return res.json({
      valid: false,
      message: 'No valid session found'
    });
  }

  const session = sessions.get(sessionId);

  // Try to refresh token if needed (only once)
  try {
    await refreshTokenIfNeeded(sessionId, session);

    if (!sessions.has(sessionId)) {
      return res.json({
        valid: false,
        message: 'Session expired and refresh failed'
      });
    }

    console.log('✅ [SERVER] Session validated:', sessionId.substring(0, 8) + '...');
    res.json({
      valid: true,
      message: 'Session is valid',
      createdAt: session.createdAt
    });
  } catch (error) {
    console.error('❌ [SERVER] Session validation error:', error.message);
    res.json({
      valid: false,
      message: 'Session validation failed'
    });
  }
});

// AI service health check
app.get('/api/health/ai', async (req, res) => {
  console.log('🤖 [SERVER] AI health check request:', {
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  if (!geminiApiKey) {
    console.log('❌ [SERVER] AI health check failed: No API key configured');
    return res.json({
      status: 'CONFIGURATION_ERROR',
      message: 'GEMINI_API_KEY not configured',
      aiAvailable: false,
      timestamp: new Date().toISOString()
    });
  }

  try {
    console.log('🔄 [SERVER] Testing Gemini API connection...');
    const modelResult = await callModel({
      model: GLOBAL_MODEL_CONFIG.primaryModel,
      currentMessage: 'Hello, this is a test message.',
      options: {
        enableModelSwitching: false, // Disable switching for health check
        enableCompaction: false
      }
    });
    const data = modelResult.data;

    console.log('✅ [SERVER] AI health check successful');
    res.json({
      status: 'OK',
      message: 'AI service is available',
      aiAvailable: true,
      model: GLOBAL_MODEL_CONFIG.primaryModel,
      responseReceived: !!data.candidates,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ [SERVER] AI health check failed:', {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      stack: error.stack,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.json({
      status: 'ERROR',
      message: 'AI service is not available',
      aiAvailable: false,
      error: error.message,
      details: error.response?.data || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Google Calendar OAuth endpoints
app.get('/api/auth/google', (req, res) => {
  console.log('🔄 [SERVER] OAuth initiation request:', {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  console.log('✅ [SERVER] OAuth URL generated:', {
    authUrl: authUrl.substring(0, 100) + '...',
    scopes: scopes
  });

  res.json({ authUrl });
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  console.log('🔄 [SERVER] OAuth callback received:', {
    code: code ? code.substring(0, 10) + '...' : 'none',
    ip: req.ip
  });

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Create a session with conversation history and preferred model
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    sessions.set(sessionId, {
      tokens,
      createdAt: new Date(),
      conversationHistory: [],
      preferredModel: GLOBAL_MODEL_CONFIG.primaryModel // Default preferred model
    });

    // Save sessions to persistent storage
    await saveSessions();

    console.log('✅ [SERVER] OAuth tokens received and session created:', {
      sessionId: sessionId.substring(0, 8) + '...',
      accessToken: tokens.access_token ? tokens.access_token.substring(0, 10) + '...' : 'none',
      refreshToken: tokens.refresh_token ? 'present' : 'none',
      expiresIn: tokens.expires_in
    });

    // Setup Google Calendar watch for real-time notifications
    try {
      await setupCalendarWatch(sessionId, oauth2Client);
    } catch (watchError) {
      console.log('⚠️ [SERVER] Watch setup failed, but continuing:', {
        sessionId: sessionId.substring(0, 8) + '...',
        error: watchError.message
      });
    }

    // Redirect to frontend with session ID
    const frontendUrl = process.env.CLIENT_URL || 'http://localhost:30001';
    res.redirect(`${frontendUrl}?sessionId=${sessionId}`);
  } catch (error) {
    console.error('❌ [SERVER] OAuth callback error:', {
      error: error.message,
      code: code ? code.substring(0, 10) + '...' : 'none',
      ip: req.ip
    });
    const frontendUrl = process.env.CLIENT_URL || 'http://localhost:30001';
    res.redirect(`${frontendUrl}?error=auth_failed`);
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  const sessionId = req.headers['x-session-id'];

  console.log('🚪 [SERVER] Logout request:', {
    sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
    ip: req.ip
  });

  if (sessionId && sessions.has(sessionId)) {
    // Stop Google Calendar watch before removing session
    try {
      await stopCalendarWatch(sessionId);
    } catch (watchError) {
      console.log('⚠️ [SERVER] Watch cleanup failed, but continuing:', {
        sessionId: sessionId.substring(0, 8) + '...',
        error: watchError.message
      });
    }

    sessions.delete(sessionId);
    await saveSessions();

    console.log('✅ [SERVER] Session removed:', sessionId.substring(0, 8) + '...');
    res.json({
      success: true,
      message: 'Successfully logged out'
    });
  } else {
    res.json({
      success: true,
      message: 'No active session to logout'
    });
  }
});

// Get user information from Google Calendar
app.get('/api/auth/user', requireAuth, async (req, res) => {
  const sessionId = req.headers['x-session-id'];



  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const people = google.people({ version: 'v1', auth: oauth2Client });

    // Get user's profile information from Google People API
    const profileResponse = await people.people.get({
      resourceName: 'people/me',
      personFields: 'names,emailAddresses'
    });

    // Get calendar info for timezone
    const calendarResponse = await calendar.calendarList.list();
    const primaryCalendar = calendarResponse.data.items?.find(cal => cal.primary) || calendarResponse.data.items?.[0];

    // Extract user's actual name from People API
    const person = profileResponse.data;
    const name = person.names?.[0]?.displayName || person.names?.[0]?.givenName || 'User';
    const email = person.emailAddresses?.[0]?.value || primaryCalendar?.id || '';

    const userInfo = {
      name: name,
      email: email,
      timezone: primaryCalendar?.timeZone || 'UTC',
      calendarId: primaryCalendar?.id || ''
    };



    res.json(userInfo);
  } catch (error) {
    // Log as warning if it's a permission issue (expected when People API scope not available)
    if (error.code === 403) {
      console.log('⚠️ [SERVER] People API access not available (using fallback):', {
        error: error.message,
        status: error.code,
        sessionId: sessionId.substring(0, 8) + '...',
        ip: req.ip
      });
    } else {
      console.error('❌ [SERVER] Error fetching user information:', {
        error: error.message,
        status: error.code,
        sessionId: sessionId.substring(0, 8) + '...',
        ip: req.ip
      });
    }

    // Fallback to calendar info if People API fails
    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const response = await calendar.calendarList.list();
      const primaryCalendar = response.data.items?.find(cal => cal.primary) || response.data.items?.[0];

      if (primaryCalendar) {
        // Try to extract name from calendar summary (remove "Calendar" suffix)
        let name = primaryCalendar.summary || 'User';
        if (name.toLowerCase().includes('calendar')) {
          name = name.replace(/calendar$/i, '').replace(/['s]/g, '').trim();
        }

        const userInfo = {
          name: name || 'User',
          email: primaryCalendar.id || '',
          timezone: primaryCalendar.timeZone || 'UTC',
          calendarId: primaryCalendar.id
        };



        res.json(userInfo);
        return;
      }
    } catch (fallbackError) {
      console.error('❌ [SERVER] Fallback user info also failed:', fallbackError.message);
    }

    // If both People API and Calendar fallback fail, return a basic user info
    const basicUserInfo = {
      name: 'User',
      email: '',
      timezone: 'UTC',
      calendarId: ''
    };

    console.log('⚠️ [SERVER] Using basic user info (all methods failed):', {
      sessionId: sessionId.substring(0, 8) + '...',
      name: basicUserInfo.name,
      timezone: basicUserInfo.timezone
    });

    res.json(basicUserInfo);
  }
});

// Get user's calendar events
app.get('/api/calendar/events', calendarLimiter, requireAuth, async (req, res) => {
  const { timeMin, timeMax, searchTerm } = req.query;
  const sessionId = req.headers['x-session-id'];



  try {
    // Enforce rate limiting before making API call
    await enforceCalendarRateLimit(sessionId, 'list');

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Retry logic for rate limiting
    let retryCount = 0;
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second
    let response;

    while (retryCount <= maxRetries) {
      try {
        response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          q: searchTerm
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.code === 429 && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff: 1s, 2s, 4s
          console.log(`⏳ [SERVER] Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
        } else {
          throw error; // Re-throw if not a 429 error or max retries reached
        }
      }
    }



    res.json(response.data);
  } catch (error) {
    console.error('❌ [SERVER] Google Calendar API error:', {
      error: error.message,
      status: error.code,
      sessionId: sessionId.substring(0, 8) + '...',
      ip: req.ip
    });
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// AI-powered event scheduling with Server-Sent Events
app.get('/api/ai/schedule-stream', aiLimiter, async (req, res) => {
  const { description, sessionId, timezone } = req.query;
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  // Custom auth check for SSE (since EventSource can't send custom headers)
  if (!sessionId || !sessions.has(sessionId)) {
    console.log('❌ [SERVER] SSE Authentication failed:', {
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      path: req.path,
      method: req.method
    });

    res.writeHead(401, {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: 'Authentication required. Please connect your Google Calendar first.'
    })}\n\n`);
    res.end();
    return;
  }

  console.log('🔄 [SERVER] AI scheduling request (SSE):', {
    description: description ? description.substring(0, 50) + '...' : 'none',
    sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, x-session-id, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
  });

  // Function to send SSE message
  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Clean up pending confirmation if connection is closed
  res.on('close', () => {
    console.log('🔌 [SSE] Connection closed, scheduling cleanup for pending confirmation for session:', sessionId.substring(0, 8) + '...');
    if (pendingConfirmations.has(sessionId)) {
      // Set a timeout to delete after 2 minutes if not already deleted (increased from 30s to allow for longer reconnects)
      const context = pendingConfirmations.get(sessionId);
      context.cleanupTimeout = setTimeout(() => {
        pendingConfirmations.delete(sessionId);
        console.log(`🧹 [SSE] Cleaned up pending confirmation for session: ${sessionId} after timeout`);
      }, 120000); // 2 minutes
    }
  });

  try {
    // Get user session for AI processing
    const userSession = sessions.get(sessionId);
    const userTimezone = timezone || 'UTC';

    // Build system message for AI
    const systemPrompt = generateGlobalSystemPrompt(userTimezone);

    // Get conversation history
    let fullConversationHistory = userSession.conversationHistory || [];

            // Apply compaction if needed
        fullConversationHistory = await compactConversationHistory(fullConversationHistory, {
          maxMessages: 40,
          maxTotalLength: 25000,
          preserveRecentMessages: 15,
          useAI: true,
          model: GLOBAL_MODEL_CONFIG.getCurrentModel(sessionId),
      sessionId: sessionId
    });

    // Unified AI conversation loop
    setTimeout(async () => {
      try {
        let currentConversationHistory = fullConversationHistory; // Start with original history
        let currentMessage = description; // Start with user's initial message

        while (true) {
          // Get AI response
          const modelResult = await callModel({
            model: GLOBAL_MODEL_CONFIG.getCurrentModel(sessionId),
            conversationHistory: currentConversationHistory,
            currentMessage: currentMessage,
            systemPrompt: systemPrompt,
            sessionId: sessionId,
            requestId: requestId,
            options: { enableModelSwitching: true, enableCompaction: currentMessage === '' }
          });

          const aiResponseText = modelResult.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const aiResponse = parseAiResponse(aiResponseText);

          // Add user message to conversation history (first iteration only)
          if (currentMessage !== '') {
            currentConversationHistory = [
              ...currentConversationHistory,
              { role: 'user', content: currentMessage, timestamp: new Date() }
            ];
          }

          // Add AI response to conversation history
          currentConversationHistory = [
            ...currentConversationHistory,
            { role: 'model', content: aiResponse.message, timestamp: new Date() }
          ];

          // If no tools requested, send final response and exit
          if (!aiResponse.tools || aiResponse.tools.length === 0) {
            userSession.conversationHistory = currentConversationHistory;
            sessions.set(sessionId, userSession);
            await saveSessions();

            console.log('✅ [SSE] Sending final message:', aiResponse.message.substring(0, 100) + '...');
            sendSSE({ type: 'final', message: aiResponse.message });
            res.end();
            return;
          }

          // Check for confirmation requirement
          const toolsRequiringConfirmation = aiResponse.tools.filter(t => {
            const toolConfig = toolHandlers[t.tool];
            return toolConfig && toolConfig.requiresConfirmation;
          });

          if (toolsRequiringConfirmation.length > 0) {
            console.log('⚠️ [SSE] Tools require confirmation, keeping connection alive');

            // Store SSE context for later continuation
            pendingConfirmations.set(sessionId, {
              res,
              sendSSE,
              tools: aiResponse.tools,
              aiResponse,
              currentConversationHistory,
              userSession
            });

            sendSSE({
              type: 'confirmation',
              message: aiResponse.message,
              tools: aiResponse.tools,
              requiresConfirmation: true
            });

            // Don't end connection - wait for confirm-tools to continue
            return;
          }

          // Send intermittent message
          console.log('🔄 [SSE] Processing tools:', aiResponse.tools.map(t => t.tool));
          sendSSE({
            type: 'intermittent',
            message: aiResponse.message,
            tools: aiResponse.tools.map(t => ({ name: t.tool, status: 'running' }))
          });

          // Execute tools
          const toolResults = [];
          for (const [index, toolRequest] of aiResponse.tools.entries()) {
            try {
              // Rate limiting
              if (index > 0 && ['delete_event', 'create_event', 'update_event'].includes(toolRequest.tool)) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }

              // Setup OAuth2 client
              if (!userSession.tokens) {
                toolResults.push({ success: false, message: 'Please reconnect your Google Calendar' });
                continue;
              }

              const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
              );
              oauth2Client.setCredentials(userSession.tokens);
              await refreshTokenIfNeeded(sessionId, userSession);

              // Execute tool
              const toolResult = await processTool(toolRequest.tool, toolRequest.parameters, sessionId, oauth2Client);
              toolResults.push(toolResult);

            } catch (toolError) {
              console.error('❌ [SSE] Tool error:', toolError);
              toolResults.push({ success: false, message: `Failed to ${toolRequest.tool}: ${toolError.message}` });
            }
          }

          currentMessage = `TOOL_RESULTS: ${JSON.stringify(toolResults, null, 2)}`;
        }

      } catch (processingError) {
        console.error('❌ [SSE] Processing error:', processingError);
        sendSSE({ type: 'final', message: 'Sorry, an error occurred during processing.' });
        res.end();
      }
    }, 100);

  } catch (error) {
    console.error('❌ [SERVER] SSE error:', error);
    sendSSE({ type: 'error', message: '处理过程中出错，请稍后再试。' });
    res.end();
  }
});

// Simplified tool confirmation - just execute and notify SSE
app.post('/api/ai/confirm-tools', aiLimiter, requireAuth, async (req, res) => {
  const { confirmed } = req.body;
  const sessionId = req.headers['x-session-id'];
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  console.log('🔄 [SERVER] Tool confirmation request:', {
    requestId,
    sessionId: sessionId.substring(0, 8) + '...',
    confirmed,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  try {
    // Get pending confirmation context
    const pendingContext = pendingConfirmations.get(sessionId);
    if (!pendingContext) {
      return res.status(404).json({ error: 'No pending confirmation found' });
    }
    if (pendingContext.cleanupTimeout) {
      clearTimeout(pendingContext.cleanupTimeout);
    }
    pendingConfirmations.delete(sessionId);

    const { res: sseRes, sendSSE, tools, currentConversationHistory, userSession } = pendingContext;

    if (!confirmed) {
      // User cancelled - notify SSE and let it handle with AI
      console.log('❌ [SERVER] User cancelled tool execution');

      // Add cancellation to conversation history
      const updatedHistory = [
        ...currentConversationHistory,
        { role: 'user', content: 'User cancelled the requested operations.', timestamp: new Date() }
      ];

      // Continue SSE with cancellation - it will call AI to handle this
      continueSSEAfterConfirmation(sessionId, updatedHistory, null, true);

      return res.json({
        success: true,
        message: '',
        cancelled: true
      });
    }

    // User confirmed - execute tools
    console.log('✅ [SERVER] User confirmed tool execution, proceeding...');

    // Set up OAuth2 client for tool execution
    if (!userSession.tokens) {
      pendingConfirmations.delete(sessionId);
      return res.status(401).json({ error: 'Please reconnect your Google Calendar' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(userSession.tokens);
    await refreshTokenIfNeeded(sessionId, userSession);

    // Execute tools with rate limiting
    const toolResults = [];
    for (const [index, toolRequest] of tools.entries()) {
      try {
        // Add delay between calendar operations
        if (index > 0 && ['delete_event', 'create_event', 'update_event'].includes(toolRequest.tool)) {
          const delay = 1000;
          console.log(`⏳ [SERVER] Adding ${delay}ms delay between ${toolRequest.tool} operations (${index + 1}/${tools.length})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        console.log(`🔧 [SERVER] Executing confirmed tool ${index + 1}/${tools.length}: ${toolRequest.tool}`);

        // Use unified tool processing
        const toolResult = await processTool(toolRequest.tool, toolRequest.parameters, sessionId, oauth2Client);
        toolResults.push(toolResult);

        console.log(`✅ [SERVER] Confirmed tool ${index + 1} completed:`, {
          tool: toolRequest.tool,
          success: toolResult.success,
          message: toolResult.message?.substring(0, 50) + '...'
        });
      } catch (toolError) {
        console.error(`❌ [SERVER] Confirmed tool ${index + 1} processing error:`, toolError);
        toolResults.push({
          success: false,
          message: `Failed to ${toolRequest.tool}: ${toolError.message}`
        });
      }
    }

    // Add tool results to conversation history
    const updatedHistory = [
      ...currentConversationHistory,
      { role: 'user', content: 'Confirm operations', timestamp: new Date() },
      { role: 'user', content: `TOOL_RESULTS: ${JSON.stringify(toolResults, null, 2)}`, timestamp: new Date() }
    ];

    // Instead of sending a final message here, resume the SSE loop so the AI can summarize the tool results
    continueSSEAfterConfirmation(sessionId, updatedHistory, toolResults, false);

    // Respond to the HTTP request with a simple acknowledgement (the SSE will handle the user-facing message)
    res.json({
      success: true,
      message: '',
      toolResults: toolResults,
      confirmed: true
    });

  } catch (error) {
    console.error('❌ [SERVER] Tool confirmation error:', error);
    // Clean up pending confirmation on error
    pendingConfirmations.delete(sessionId);
    res.status(500).json({
      error: 'Failed to process tool confirmation',
      details: error.message
    });
  }
});

// Create calendar event
app.post('/api/calendar/events', requireAuth, async (req, res) => {
  const { title, description, startTime, endTime, location, attendees, reminders } = req.body;
  const sessionId = req.headers['x-session-id'];
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  console.log('🔄 [SERVER] Creating calendar event:', {
    requestId,
    sessionId: sessionId.substring(0, 8) + '...',
    title,
    description: description?.substring(0, 50) + (description?.length > 50 ? '...' : ''),
    startTime,
    endTime,
    location,
    attendeesCount: attendees?.length || 0,
    attendees: attendees,
    reminders,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Validate required fields
  if (!title || !startTime || !endTime) {
    console.error('❌ [SERVER] Missing required fields for event creation:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      hasTitle: !!title,
      hasStartTime: !!startTime,
      hasEndTime: !!endTime,
      requestBody: req.body
    });
    return res.status(400).json({ error: 'Missing required fields: title, startTime, endTime' });
  }

  // Validate date formats
  try {
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error('❌ [SERVER] Invalid date format for event creation:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        startTime,
        endTime,
        startDateValid: !isNaN(startDate.getTime()),
        endDateValid: !isNaN(endDate.getTime())
      });
      return res.status(400).json({ error: 'Invalid date format' });
    }

    if (endDate <= startDate) {
      console.error('❌ [SERVER] End time must be after start time:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString()
      });
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    console.log('✅ [SERVER] Date validation passed:', {
      requestId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      durationMinutes: Math.round((endDate - startDate) / (1000 * 60))
    });
  } catch (dateError) {
    console.error('❌ [SERVER] Date parsing error:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      error: dateError.message,
      startTime,
      endTime
    });
    return res.status(400).json({ error: 'Invalid date format' });
  }

  try {
    // Get user's timezone from the request or use UTC as fallback
    const userTimezone = req.body.timezone || 'UTC';

    const event = {
      summary: title,
      description: description,
      start: {
        dateTime: startTime,
        timeZone: userTimezone,
      },
      end: {
        dateTime: endTime,
        timeZone: userTimezone,
      },
      location: location,
      attendees: attendees ? attendees.map(email => ({ email })) : [],
      reminders: {
        useDefault: false,
        overrides: reminders ? reminders.map(reminder => ({
          method: 'email',
          minutes: reminder === '15 minutes before' ? 15 : 60
        })) : []
      }
    };

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    console.log('🌐 [SERVER] Making Google Calendar API call to create event...', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      calendarId: 'primary',
      eventSummary: event.summary,
      eventData: {
        summary: event.summary,
        start: event.start,
        end: event.end,
        location: event.location,
        attendeesCount: event.attendees?.length || 0,
        reminders: event.reminders
      },
      fullEventObject: event
    });

    const apiStartTime = Date.now();
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all'
    });
    const apiEndTime = Date.now();
    const apiResponseTime = apiEndTime - apiStartTime;

    console.log('✅ [SERVER] Google Calendar API event created successfully:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      eventId: response.data.id,
      eventSummary: response.data.summary,
      htmlLink: response.data.htmlLink,
      apiResponseTime: `${apiResponseTime}ms`,
      responseData: {
        id: response.data.id,
        summary: response.data.summary,
        start: response.data.start,
        end: response.data.end,
        location: response.data.location,
        attendeesCount: response.data.attendees?.length || 0,
        reminders: response.data.reminders
      }
    });

    res.json({
      success: true,
      event: response.data
    });

  } catch (error) {
    console.error('❌ [SERVER] Create event error:', {
      requestId,
      error: error.message,
      errorCode: error.code,
      errorStatus: error.response?.status,
      errorStatusText: error.response?.statusText,
      errorResponseData: error.response?.data,
      errorStack: error.stack,
      requestData: {
        title,
        description: description?.substring(0, 50) + (description?.length > 50 ? '...' : ''),
        startTime,
        endTime,
        location,
        attendeesCount: attendees?.length || 0,
        attendees: attendees,
        reminders
      },
      sessionId: sessionId.substring(0, 8) + '...',
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to create calendar event';
    let statusCode = 500;

    if (error.code === 401) {
      errorMessage = 'Authentication failed - please reconnect your Google Calendar';
      statusCode = 401;
    } else if (error.code === 403) {
      errorMessage = 'Permission denied - check your Google Calendar permissions';
      statusCode = 403;
    } else if (error.code === 400) {
      errorMessage = 'Invalid event data - please check your event details';
      statusCode = 400;
    } else if (error.code === 429) {
      errorMessage = 'Rate limit exceeded - please try again later';
      statusCode = 429;
    } else if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.response?.data?.error?.message || error.message,
      code: error.code
    });
  }
});

// Track Pomodoro suggestion cooldowns to prevent spam
const pomodoroCooldowns = new Map();
const sessionCooldowns = new Map(); // Track overall session cooldowns

// AI Pomodoro suggestion endpoint
app.post('/api/ai/pomodoro-suggestion', aiLimiter, requireAuth, async (req, res) => {
  const { upcomingEvents, userLanguage, initializeSession } = req.body;
  const sessionId = req.headers['x-session-id'];
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  // Check session-level cooldown first (prevents overall spam)
  const now = Date.now();
  const sessionCooldownTime = 30 * 1000; // 30 seconds between any Pomodoro requests

  if (sessionCooldowns.has(sessionId)) {
    const lastSessionRequest = sessionCooldowns.get(sessionId);
    const timeSinceLastSessionRequest = now - lastSessionRequest;

    if (timeSinceLastSessionRequest < sessionCooldownTime) {
      const remainingSessionCooldown = Math.ceil((sessionCooldownTime - timeSinceLastSessionRequest) / 1000);
      console.log('⏰ [SERVER] Session-level Pomodoro cooldown active:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        remainingCooldown: `${remainingSessionCooldown}s`
      });

      return res.status(429).json({
        error: 'Session cooldown active',
        message: `Please wait ${remainingSessionCooldown} seconds before requesting another Pomodoro suggestion`,
        remainingCooldown: remainingSessionCooldown
      });
    }
  }

  // Check event-specific cooldown
  if (upcomingEvents && upcomingEvents.length > 0) {
    const primaryEvent = upcomingEvents[0];
    // Use event title and a time bucket (5-minute intervals) to prevent spam
    const timeBucket = Math.floor(primaryEvent.timeUntilEvent / 5) * 5;
    const cooldownKey = `${sessionId}-${primaryEvent.title}-${timeBucket}`;

    // Adjust cooldown based on event urgency
    let cooldownTime;
    if (primaryEvent.timeUntilEvent <= 2) {
      cooldownTime = 2 * 60 * 1000; // 2 minutes for very urgent events
    } else if (primaryEvent.timeUntilEvent <= 5) {
      cooldownTime = 3 * 60 * 1000; // 3 minutes for urgent events
    } else {
      cooldownTime = 5 * 60 * 1000; // 5 minutes for normal events
    }

    if (pomodoroCooldowns.has(cooldownKey)) {
      const lastRequest = pomodoroCooldowns.get(cooldownKey);
      const timeSinceLastRequest = now - lastRequest;

      if (timeSinceLastRequest < cooldownTime) {
        const remainingCooldown = Math.ceil((cooldownTime - timeSinceLastRequest) / 1000);
        console.log('⏰ [SERVER] Pomodoro suggestion cooldown active:', {
          requestId,
          sessionId: sessionId.substring(0, 8) + '...',
          eventTitle: primaryEvent.title,
          timeUntilEvent: primaryEvent.timeUntilEvent,
          timeBucket: timeBucket,
          remainingCooldown: `${remainingCooldown}s`,
          timeSinceLastRequest: `${Math.round(timeSinceLastRequest / 1000)}s`
        });

        return res.status(429).json({
          error: 'Pomodoro suggestion cooldown',
          message: `Please wait ${remainingCooldown} seconds before requesting another Pomodoro suggestion for this event`,
          remainingCooldown
        });
      }
    }

    // Update cooldown timestamps
    pomodoroCooldowns.set(cooldownKey, now);
    sessionCooldowns.set(sessionId, now);

    // Clean up old cooldowns (older than 1 hour)
    for (const [key, timestamp] of pomodoroCooldowns.entries()) {
      if (now - timestamp > 60 * 60 * 1000) {
        pomodoroCooldowns.delete(key);
      }
    }

    // Clean up old session cooldowns (older than 1 hour)
    for (const [key, timestamp] of sessionCooldowns.entries()) {
      if (now - timestamp > 60 * 60 * 1000) {
        sessionCooldowns.delete(key);
      }
    }
  } else {
    // Update session cooldown even if no events
    sessionCooldowns.set(sessionId, now);
  }

  console.log('🍅 [SERVER] Pomodoro suggestion request:', {
    requestId,
    sessionId: sessionId.substring(0, 8) + '...',
    upcomingEventsCount: upcomingEvents?.length || 0,
    initializeSession,
    userLanguage,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Get session data
  const session = sessions.get(sessionId);
  if (!session) {
    console.error('❌ [SERVER] Session not found for Pomodoro suggestion:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...'
    });
    return res.status(401).json({ error: 'Session not found' });
  }

  // Log detailed event information
  if (upcomingEvents && upcomingEvents.length > 0) {
    console.log('📅 [SERVER] Upcoming events details:', {
      requestId,
      events: upcomingEvents.map((event, index) => ({
        index: index + 1,
        title: event.title,
        time: event.time,
        date: event.date,
        duration: event.duration,
        durationMinutes: event.durationMinutes,
        timeUntilEvent: event.timeUntilEvent,
        location: event.location,
        attendees: event.attendees,
        eventType: event.eventType,
        hasReminders: event.hasReminders,
        isAllDay: event.isAllDay
      }))
    });
  }

  // Handle session initialization and prompt construction
  let prompt;
  if (initializeSession) {
    // First time - create and store system prompt
    const languageName = userLanguage === 'zh' ? 'Chinese' :
      userLanguage === 'ja' ? 'Japanese' :
        userLanguage === 'ko' ? 'Korean' :
          userLanguage === 'es' ? 'Spanish' :
            userLanguage === 'fr' ? 'French' :
              userLanguage === 'de' ? 'German' : 'English';

    const systemPrompt = `You are a helpful productivity assistant. The user speaks ${languageName}. Respond in the same language.

You help users optimize their Pomodoro work sessions based on their upcoming calendar events. You suggest:
- Work duration (2-25 min)
- Break duration (1-10 min) 
- Focus area
- Brief preparation tips

Always respond in JSON format:
{
  "message": "Brief, encouraging message in user's language",
  "workDuration": number,
  "breakDuration": number,
  "focus": "What to focus on",
  "preparation": "Brief prep tips"
}

CRITICAL RULES:
- ALWAYS write human-readable, friendly messages in the "message" field
- NEVER include technical jargon, JSON code, or system messages in the "message" field
- Write messages as if talking to a friend - natural, encouraging, and conversational
- Keep messages concise but motivating
- Use the user's language (${languageName})`;

    // Store system prompt in session
    session.pomodoroSystemPrompt = systemPrompt;
    sessions.set(sessionId, session);
    await saveSessions();

    console.log('🔄 [SERVER] Pomodoro system prompt initialized for session:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      systemPromptLength: systemPrompt.length
    });
  }

  // Construct the full prompt
  const systemPrompt = session.pomodoroSystemPrompt;
  if (!systemPrompt) {
    console.error('❌ [SERVER] No system prompt found for session:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...'
    });
    return res.status(500).json({ error: 'System prompt not initialized' });
  }

  const eventDetails = upcomingEvents.map((event, index) => `
${index + 1}. ${event.title} ${index === 0 ? '(CURRENT UPCOMING EVENT)' : '(FUTURE EVENT)'}
   ⏰ Starts in: ${event.timeUntilEvent} minutes
   ⏱️ Duration: ${event.duration}
   🏷️ Type: ${event.eventType}
   📍 Location: ${event.location}
`).join('\n');

  prompt = `${systemPrompt}

The user has ${upcomingEvents.length} upcoming event(s) in the next 5 minutes:

${eventDetails}

TIMING: Event #1 can overlap with Pomodoro. Events #2+ cannot overlap.

Suggest optimal Pomodoro strategy:`;

  try {
    const aiStartTime = Date.now();
    const modelResult = await callModel({
      model: GLOBAL_MODEL_CONFIG.getCurrentModel(sessionId),
      currentMessage: prompt,
      sessionId: sessionId,
      requestId: requestId,
      options: {
        enableModelSwitching: true,
        enableCompaction: false // No conversation history for this call
      }
    });
    const data = modelResult.data;
    const aiEndTime = Date.now();
    const responseTime = aiEndTime - aiStartTime;

    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('✅ [SERVER] Pomodoro suggestion received:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      responseLength: aiResponse.length,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    });

    // Log the full AI response
    console.log('🤖 [SERVER] AI Response received:', {
      requestId,
      responseLength: aiResponse.length,
      responsePreview: aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''),
      fullResponse: aiResponse
    });

    // Try to parse the response as JSON
    let suggestion;
    try {
      // Remove Markdown code block fencing if present
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json/, '').trim();
      }
      if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```/, '').trim();
      }
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.replace(/```$/, '').trim();
      }

      console.log('🔧 [SERVER] Attempting to parse AI response:', {
        requestId,
        originalResponseLength: aiResponse.length,
        cleanedResponseLength: cleanResponse.length,
        cleanedResponsePreview: cleanResponse.substring(0, 300) + (cleanResponse.length > 300 ? '...' : '')
      });

      suggestion = JSON.parse(cleanResponse);

      console.log('✅ [SERVER] Pomodoro suggestion parsed successfully:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        sessions: suggestion.sessions,
        workDuration: suggestion.workDuration,
        breakDuration: suggestion.breakDuration,
        messageLength: suggestion.message?.length || 0,
        focus: suggestion.focus,
        preparation: suggestion.preparation,
        parsedSuggestion: suggestion
      });

      res.json(suggestion);
    } catch (parseError) {
      console.error('❌ [SERVER] Failed to parse Pomodoro suggestion as JSON:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        error: parseError.message,
        errorStack: parseError.stack,
        originalResponse: aiResponse,
        cleanedResponse: cleanResponse,
        timestamp: new Date().toISOString()
      });

      // Return a fallback suggestion
      const upcomingEventInfo = upcomingEvents?.length > 0 ?
        `${upcomingEvents[0].title} in ${upcomingEvents[0].timeUntilEvent || 5} minutes` :
        'upcoming event';

      const fallbackSuggestion = {
        message: `You have ${upcomingEvents?.length || 1} upcoming event(s) in the next 5 minutes. Perfect time for a focused Pomodoro session! 🍅`,
        sessions: 1,
        workDuration: 15, // Default work duration
        breakDuration: 3, // Default break duration
        workReasoning: 'Standard 15-minute session for focused preparation',
        breakReasoning: 'Short 3-minute break to maintain momentum',
        focus: 'Prepare for your upcoming events',
        preparation: 'Take a moment to organize your thoughts and materials',
        upcomingEvent: upcomingEventInfo
      };

      console.log('🔄 [SERVER] Returning fallback suggestion due to parse error:', {
        requestId,
        fallbackSuggestion
      });

      res.json(fallbackSuggestion);
    }
  } catch (error) {
    console.error('❌ [SERVER] Pomodoro suggestion error:', {
      requestId,
      error: error.message,
      errorStack: error.stack,
      errorCode: error.code,
      errorStatus: error.status,
      sessionId: sessionId.substring(0, 8) + '...',
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // Return a fallback suggestion
    const upcomingEventInfo = upcomingEvents?.length > 0 ?
      `${upcomingEvents[0].title} in ${upcomingEvents[0].timeUntilEvent || 5} minutes` :
      'upcoming event';

    const fallbackSuggestion = {
      message: `You have ${upcomingEvents?.length || 1} upcoming event(s) in the next 5 minutes. Would you like to start a Pomodoro work session?`,
      sessions: 1,
      workDuration: 15, // Default work duration
      breakDuration: 3, // Default break duration
      workReasoning: 'Standard 15-minute session for focused preparation',
      breakReasoning: 'Short 3-minute break to maintain momentum',
      focus: 'Prepare for your upcoming events',
      preparation: 'Take a moment to organize your thoughts',
      upcomingEvent: upcomingEventInfo
    };

    console.log('🔄 [SERVER] Returning fallback suggestion due to API error:', {
      requestId,
      fallbackSuggestion
    });

    res.json(fallbackSuggestion);
  }
});

// Update calendar event
app.put('/api/calendar/events/:eventId', requireAuth, async (req, res) => {
  const { eventId } = req.params;
  const { title, description, startTime, endTime, location, attendees, reminders } = req.body;
  const sessionId = req.headers['x-session-id'];

  console.log('🔄 [SERVER] Updating calendar event:', {
    sessionId: sessionId.substring(0, 8) + '...',
    eventId,
    title,
    startTime,
    endTime,
    location,
    attendeesCount: attendees?.length || 0,
    ip: req.ip
  });

  try {
    const event = {
      summary: title,
      description: description,
      start: {
        dateTime: startTime,
        timeZone: 'UTC',
      },
      end: {
        dateTime: endTime,
        timeZone: 'UTC',
      },
      location: location,
      attendees: attendees ? attendees.map(email => ({ email })) : [],
      reminders: {
        useDefault: false,
        overrides: reminders ? reminders.map(reminder => ({
          method: 'email',
          minutes: reminder === '15 minutes before' ? 15 : 60
        })) : []
      }
    };

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    console.log('🌐 [SERVER] Making Google Calendar API call to update event...', {
      sessionId: sessionId.substring(0, 8) + '...',
      calendarId: 'primary',
      eventId,
      eventSummary: event.summary
    });

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      resource: event,
      sendUpdates: 'all'
    });

    console.log('✅ [SERVER] Google Calendar API event updated:', {
      sessionId: sessionId.substring(0, 8) + '...',
      eventId: response.data.id,
      eventSummary: response.data.summary,
      htmlLink: response.data.htmlLink
    });

    res.json({
      success: true,
      event: response.data
    });

  } catch (error) {
    console.error('❌ [SERVER] Update event error:', {
      error: error.message,
      status: error.code,
      sessionId: sessionId.substring(0, 8) + '...',
      eventId,
      title,
      ip: req.ip
    });
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

// Google Calendar webhook endpoint for real-time notifications
app.post('/api/calendar/webhook/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  console.log('🔄 [SERVER] Received Google Calendar webhook:', {
    sessionId: sessionId.substring(0, 8) + '...',
    headers: req.headers,
    body: req.body,
    ip: req.ip
  });

  try {
    // Verify this is a valid Google Calendar webhook
    const subscription = watchSubscriptions.get(sessionId);
    if (!subscription) {
      console.log('⚠️ [SERVER] No active subscription found for webhook:', sessionId.substring(0, 8) + '...');
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Handle different types of notifications
    const { state, resourceId, resourceUri } = req.body;

    if (state === 'exists') {
      // Calendar events have changed, notify connected clients
      console.log('📅 [SERVER] Calendar events changed, notifying clients:', {
        sessionId: sessionId.substring(0, 8) + '...',
        resourceId,
        resourceUri
      });

      // Here you would typically send a WebSocket message to connected clients
      // For now, we'll just log the change
      console.log('🔄 [SERVER] Calendar events updated, clients should refresh');
    }

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ [SERVER] Webhook processing error:', {
      sessionId: sessionId.substring(0, 8) + '...',
      error: error.message
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Delete calendar event
app.delete('/api/calendar/events/:eventId', requireAuth, calendarEventLimiter, async (req, res) => {
  const { eventId } = req.params;
  const sessionId = req.headers['x-session-id'];
  const { confirmed } = req.query; // Check if user confirmed the deletion

  console.log('🔄 [SERVER] Deleting calendar event:', {
    sessionId: sessionId.substring(0, 8) + '...',
    eventId,
    confirmed: confirmed === 'true',
    ip: req.ip
  });

  // Check if deletion is confirmed
  if (confirmed !== 'true') {
    return res.status(400).json({
      error: 'Deletion not confirmed',
      message: 'Please confirm the deletion before proceeding'
    });
  }

  try {
    // Enforce rate limiting before making API call
    await enforceCalendarRateLimit(sessionId, 'delete');

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    console.log('🌐 [SERVER] Making Google Calendar API call to delete event...', {
      sessionId: sessionId.substring(0, 8) + '...',
      calendarId: 'primary',
      eventId
    });

    // Retry logic for rate limiting with better backoff
    let retryCount = 0;
    const maxRetries = 5; // Increased retries
    const baseDelay = 2000; // 2 seconds base delay

    while (retryCount <= maxRetries) {
      try {
        await calendar.events.delete({
          calendarId: 'primary',
          eventId: eventId,
          sendUpdates: 'all'
        });
        break; // Success, exit retry loop
      } catch (error) {
        if (error.code === 429 && retryCount < maxRetries) {
          // Exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s
          const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
          console.log(`⏳ [SERVER] Rate limited, retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
        } else {
          throw error; // Re-throw if not a 429 error or max retries reached
        }
      }
    }

    console.log('✅ [SERVER] Google Calendar API event deleted:', {
      sessionId: sessionId.substring(0, 8) + '...',
      eventId
    });

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('❌ [SERVER] Delete event error:', {
      error: error.message,
      status: error.code,
      sessionId: sessionId.substring(0, 8) + '...',
      eventId,
      ip: req.ip
    });

    // Handle specific error cases
    let errorMessage = 'Failed to delete calendar event';
    let statusCode = 500;

    if (error.code === 410) {
      // Event was already deleted - this is actually a success case
      errorMessage = 'Event was already deleted';
      statusCode = 200;
    } else if (error.code === 401) {
      errorMessage = 'Authentication failed - please reconnect your Google Calendar';
      statusCode = 401;
    } else if (error.code === 403) {
      errorMessage = 'Permission denied - check your Google Calendar permissions';
      statusCode = 403;
    } else if (error.code === 404) {
      errorMessage = 'Event not found - it may have been deleted already';
      statusCode = 404;
    } else if (error.code === 429) {
      errorMessage = 'Rate limit exceeded - please try again later';
      statusCode = 429;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message,
      code: error.code
    });
  }
});

// Helper function to find available time slots
async function findAvailableTimeSlots(constraints, oauth2Client) {
  try {
    const { startDate, endDate, duration, workingHours } = constraints;

    console.log('🔄 [SERVER] Finding available time slots:', {
      startDate,
      endDate,
      duration,
      workingHours
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get existing events in the date range
    console.log('🌐 [SERVER] Making Google Calendar API call to get existing events...', {
      timeMin: startDate,
      timeMax: endDate
    });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];

    console.log('✅ [SERVER] Existing events retrieved for time slot calculation:', {
      eventCount: events.length,
      timeRange: `${startDate} to ${endDate}`
    });

    // Generate time slots and filter out busy times
    const timeSlots = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
      const dayStart = new Date(date);
      dayStart.setHours(workingHours.start, 0, 0, 0);

      const dayEnd = new Date(date);
      dayEnd.setHours(workingHours.end, 0, 0, 0);

      for (let time = new Date(dayStart); time < dayEnd; time.setMinutes(time.getMinutes() + 30)) {
        const slotEnd = new Date(time.getTime() + duration * 60 * 1000);

        // Check if slot conflicts with existing events
        const conflicts = events.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          return time < eventEnd && slotEnd > eventStart;
        });

        if (!conflicts) {
          timeSlots.push(time.toISOString());
        }
      }
    }

    console.log('✅ [SERVER] Available time slots calculated:', {
      totalSlots: timeSlots.length,
      dateRange: `${startDate} to ${endDate}`
    });

    return timeSlots;
  } catch (error) {
    console.error('❌ [SERVER] Error finding time slots:', {
      error: error.message,
      constraints: constraints
    });
    return [];
  }
}

// Debug endpoint to clear conversation history for the current session
app.post('/api/debug/clear-history', requireAuth, async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: 'No valid session found' });
  }
  const session = sessions.get(sessionId);
  console.log('💾 [SERVER] Clearing conversation history for sessionId: ', sessionId,  'conversationHistory: ', session.conversationHistory);
  session.conversationHistory = [];
  session.preferredModel = GLOBAL_MODEL_CONFIG.primaryModel;
  sessions.set(sessionId, session);
  await saveSessions();
  console.log('💾 [SERVER] Conversation history cleared');
  res.json({ success: true, message: 'Conversation history cleared' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 [SERVER] VibeCalendar API server running on port ${PORT}`);
  console.log(`📊 [SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 [SERVER] Client URL: ${process.env.CLIENT_URL || 'http://localhost:30001'}`);
  console.log(`🤖 [SERVER] AI Provider: Google Gemini`);
  console.log(`📅 [SERVER] Calendar Provider: Google Calendar`);
}).on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ [SERVER] Port ${PORT} is already in use. Please try one of the following:`);
    console.error(`   1. Kill the process using port ${PORT}: lsof -ti:${PORT} | xargs kill -9`);
    console.error(`   2. Use a different port by setting PORT environment variable`);
    console.error(`   3. Wait a moment and try again`);
  } else {
    console.error(`❌ [SERVER] Failed to start server:`, error.message);
  }
  process.exit(1);
});

// Utility to estimate token usage (very rough, 1 token ≈ 4 chars for English)
function estimateTokenCount(messages) {
  return Math.ceil(messages.reduce((sum, msg) => {
    const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + (contentStr?.length || 0);
  }, 0) / 4);
}

// Unified model call function with automatic model switching
async function callModel({
  model,
  conversationHistory = [],
  currentMessage,
  systemPrompt = null,
  sessionId = null,
  options = {}
}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    enableModelSwitching = true,
    enableCompaction = true,
    timeout = 25000
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

// Unified conversation history compaction utility with AI fallback
const compactConversationHistory = async (conversationHistory, options = {}) => {
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

  // If over safe limits, try traditional compaction first
  let compacted = [...preserved];
  // Add as many older messages as possible (oldest first, not already preserved)
  for (const msg of conversationHistory) {
    if (!compacted.includes(msg) && !msg.pinned && !msg.important) {
      compacted.push(msg);
      const chars = compacted.reduce((sum, m) => {
        const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return sum + (contentStr?.length || 0);
      }, 0);
      const tokens = estimateTokenCount(compacted);
      if (chars > HARD_CHAR_LIMIT || tokens > HARD_TOKEN_LIMIT) {
        compacted.pop();
        break;
      }
    }
  }

  // Final check: if still over, trim oldest non-pinned until under limit
  while (compacted.length > 0 && (compacted.reduce((sum, m) => {
    const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + (contentStr?.length || 0);
  }, 0) > HARD_CHAR_LIMIT || estimateTokenCount(compacted) > HARD_TOKEN_LIMIT)) {
    // Remove oldest non-pinned, non-important
    const idx = compacted.findIndex(msg => !msg.pinned && !msg.important);
    if (idx === -1) break;
    compacted.splice(idx, 1);
  }

  // Only compact if actually over limits
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
  const compactedChars = compacted.reduce((sum, m) => {
    const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + (contentStr?.length || 0);
  }, 0);
  const compactedTokens = estimateTokenCount(compacted);

  // Only log when actual compaction occurs (reduced size)
  if (compacted.length < conversationHistory.length) {
    console.log('📝 [SERVER] Using traditional compaction (AI failed or disabled):', {
      originalLength: conversationHistory.length,
      compactedLength: compacted.length,
      originalChars: totalChars,
      compactedChars: compactedChars,
      originalTokens: totalTokens,
      compactedTokens: compactedTokens,
      pinnedCount: pinnedMessages.length
    });
  }

  return compacted;
};

// Patch geminiGenerateContent error handling for auto-compaction fallback
const originalGeminiGenerateContent = geminiGenerateContent;
geminiGenerateContent = async function patchedGeminiGenerateContent(args) {
  try {
    return await originalGeminiGenerateContent(args);
  } catch (error) {
    // Only fallback on size/token/timeout errors
    const isSizeError = error?.response?.status === 400 || error?.response?.status === 413 || (error.message && error.message.toLowerCase().includes('token'));
    const isTimeout = error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'));
    if ((isSizeError || isTimeout) && args.conversationHistory && args.conversationHistory.length > 0) {
      console.warn('🤖 [SERVER] Triggering unified compaction fallback...');
      const compacted = await compactConversationHistory(args.conversationHistory, {
        model: args.model,
        sessionId: args.sessionId,
        useAI: true
      });
      if (compacted && compacted.length > 0) {
        // Update session with compacted history (no notification message)
        if (args.sessionId && sessions.has(args.sessionId)) {
          const session = sessions.get(args.sessionId);
          session.conversationHistory = compacted;
          sessions.set(args.sessionId, session);
          await saveSessions();
          console.log('💾 [SERVER] Session updated with compacted history (no notification message)');
        }
        // Retry original request with compacted history
        return await originalGeminiGenerateContent({ ...args, conversationHistory: compacted });
      }
    }
    throw error;
  }
};
