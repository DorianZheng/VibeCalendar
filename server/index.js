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

// Load environment variables
dotenv.config();

// Language detection helper
const detectLanguage = (text) => {
  // Simple language detection based on character sets
  const chineseRegex = /[\u4e00-\u9fff]/;
  const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/;
  const koreanRegex = /[\uac00-\ud7af]/;
  const arabicRegex = /[\u0600-\u06ff]/;
  const cyrillicRegex = /[\u0400-\u04ff]/;
  
  if (chineseRegex.test(text)) return 'Chinese';
  if (japaneseRegex.test(text)) return 'Japanese';
  if (koreanRegex.test(text)) return 'Korean';
  if (arabicRegex.test(text)) return 'Arabic';
  if (cyrillicRegex.test(text)) return 'Cyrillic';
  
  // Default to English for Latin scripts
  return 'English';
};

// Action handlers registry - easily extensible for future actions
const actionHandlers = {
  'create_event': { 
    description: "Create a new event.",
    parameters: {
      event: {
        required: true,
        fields: {
          title:        { required: true,  desc: "Event title" },
          startTime:    { required: true,  desc: "Start time (ISO)" },
          endTime:      { required: true,  desc: "End time (ISO)" },
          description:  { required: false, desc: "Event details" },
          location:     { required: false, desc: "Event location" },
          attendees:    { required: false, desc: "Attendee emails" },
          reminders:    { required: false, desc: "Reminders" },
          timezone:     { required: false, desc: "Timezone" }
        }
      }
    },
    returns: {
      success: { desc: "Action success status" },
      event: { desc: "Created event data" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      const { event } = parameters;
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
    description: "Search and display events.",
    parameters: {
      criteria: {
        required: true,
        fields: {
          startDate:   { required: false, desc: "Start date (ISO)" },
          endDate:     { required: false, desc: "End date (ISO)" },
          searchTerm:  { required: false, desc: "Search keyword" }
        }
      }
    },
    returns: {
      success: { desc: "Action success status" },
      events: { desc: "Found events array" },
      count: { desc: "Event count" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      const { criteria = {} } = parameters;
      const { startDate, endDate, searchTerm } = criteria;
      
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startDate || new Date().toISOString(),
        timeMax: endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        q: searchTerm
      });
      
      const events = response.data.items || [];
      
      return {
        success: true,
        events: events,
        count: events.length,
        message: `Found ${events.length} events matching your criteria.`
      };
    }, 
    requiresConfirmation: false 
  },
  
  'update_event': { 
    description: "Update an event (confirmation required).",
    parameters: {
      eventId: { required: true, desc: "ID of event to update" },
      event: {
        required: true,
        fields: {
          title:        { required: false, desc: "New title" },
          startTime:    { required: false, desc: "New start time (ISO)" },
          endTime:      { required: false, desc: "New end time (ISO)" },
          description:  { required: false, desc: "New details" },
          location:     { required: false, desc: "New location" },
          attendees:    { required: false, desc: "New attendee emails" },
          reminders:    { required: false, desc: "New reminders" },
          timezone:     { required: false, desc: "New timezone" }
        }
      }
    },
    returns: {
      success: { desc: "Action success status" },
      event: { desc: "Updated event data" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      const { eventId, event } = parameters;
      if (!eventId || !event) {
        throw new Error('Missing event ID or event data');
      }
      
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
      const response = await calendar.events.update({
        calendarId: 'primary',
        eventId: eventId,
        resource: calendarEvent,
        sendUpdates: 'all'
      });
      
      return {
        success: true,
        event: response.data,
        message: `Event "${event.title}" updated successfully!`
      };
    }, 
    requiresConfirmation: true 
  },
  
  'delete_event': { 
    description: "Delete an event (confirmation required).",
    parameters: {
      eventId:    { required: true, desc: "ID of event to delete" },
      eventTitle: { required: false, desc: "Title for confirmation" }
    },
    returns: {
      success: { desc: "Action success status" },
      message: { desc: "User message" }
    },
    handler: async (parameters, sessionId, oauth2Client) => {
      const { eventId, eventTitle } = parameters;
      if (!eventId) {
        throw new Error('Missing event ID');
      }
      
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId,
        sendUpdates: 'all'
      });
      
      return {
        success: true,
        message: `Event "${eventTitle || 'Unknown'}" deleted successfully!`
      };
    }, 
    requiresConfirmation: true 
  }
  
  // Easy to add new actions here:
  // 'new_action': {
  //   description: "Description of what this action does",
  //   handler: async (parameters, sessionId, oauth2Client) => {
  //     // Implementation here
  //   },
  //   requiresConfirmation: false // or true if destructive
  // }
};

// Generate concise action/parameter prompt for the AI
function generateActionParameterPrompt() {
  let out = 'ACTIONS:';
  for (const [action, def] of Object.entries(actionHandlers)) {
    out += `\n- ${action}: ${def.description}`;
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
  return out;
}

// Generate action descriptions for AI prompt
const generateActionDescriptions = () => {
  return Object.entries(actionHandlers)
    .map(([actionName, config]) => `- ${actionName}: ${config.description}`)
    .join('\n');
};



// Generic action processor
const processAction = async (action, parameters, sessionId, oauth2Client) => {
  const actionConfig = actionHandlers[action];
  
  if (!actionConfig) {
    // This should not happen since the AI knows what actions are available
    console.error(`❌ [SERVER] Unknown action requested: ${action}`);
    return {
      success: false,
      message: `Unknown action: ${action}`,
      requiresConfirmation: false
    };
  }
  
  try {
    const result = await actionConfig.handler(parameters, sessionId, oauth2Client);
    return {
      ...result,
      requiresConfirmation: actionConfig.requiresConfirmation
    };
  } catch (error) {
    console.error(`❌ [SERVER] Action ${action} failed:`, error);
    return {
      success: false,
      message: `Failed to ${action}: ${error.message}`,
      requiresConfirmation: false
    };
  }
};

const app = express();
const PORT = process.env.PORT || 50001;

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
  max: 10 // limit each IP to 10 calendar requests per minute
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

async function geminiGenerateContent({ model, prompt, retryCount = 0 }) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
  const body = {
    contents: [
      { parts: [{ text: prompt }] }
    ]
  };
  const options = {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000
  };
  if (geminiAgent) options.httpsAgent = geminiAgent;
  
  console.log('🤖 [SERVER] Making Gemini API request:', {
    url: url.replace(geminiApiKey, '***API_KEY***'),
    model: model,
    promptLength: prompt.length,
    hasProxy: !!geminiAgent,
    proxyConfig: geminiProxy || 'none',
    timeout: options.timeout,
    retryCount: retryCount,
    timestamp: new Date().toISOString()
  });
  
  try {
  const response = await axios.post(url, body, options);
    console.log('✅ [SERVER] Gemini API request successful:', {
      status: response.status,
      statusText: response.statusText,
      responseSize: JSON.stringify(response.data).length,
      retryCount: retryCount,
      timestamp: new Date().toISOString()
    });
  return response.data;
  } catch (error) {
    console.error('❌ [SERVER] Gemini API request failed:', {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestUrl: url.replace(geminiApiKey, '***API_KEY***'),
      requestBody: {
        model: model,
        promptLength: prompt.length,
        hasProxy: !!geminiAgent
      },
      retryCount: retryCount,
      timestamp: new Date().toISOString()
    });
    
    // Retry logic for 503 errors (service overload) and 429 errors (rate limit)
    if ((error.response?.status === 503 || error.response?.status === 429) && retryCount < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff: 1s, 2s, 4s
      console.log(`🔄 [SERVER] Retrying Gemini API request in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return geminiGenerateContent({ model, prompt, retryCount: retryCount + 1 });
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
    console.log('🔄 [SERVER] Testing Google Gemini API connection...');
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash-exp', prompt: 'Hello' });
    if (data && data.candidates) {
      console.log('✅ [SERVER] Google Gemini API connection successful');
    } else {
      console.log('⚠️ [SERVER] Gemini API responded but no candidates in response');
    }
  } catch (error) {
    if (error.response) {
      console.error('❌ [SERVER] Google Gemini API connection failed:', error.response.data);
    } else {
      console.error('❌ [SERVER] Google Gemini API connection failed:', error.message);
    }
    console.log('💡 [SERVER] Please check your GEMINI_API_KEY and internet connection');
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

// Google Calendar Watch API setup
const setupCalendarWatch = async (sessionId, oauth2Client) => {
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
  
  console.log('🔐 [SERVER] Authentication check:', {
    sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
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
  console.log('✅ [SERVER] Authentication successful:', {
    sessionId: sessionId.substring(0, 8) + '...',
    path: req.path,
    method: req.method
  });
  next();
};

// Routes
app.get('/api/health', (req, res) => {
  console.log('🏥 [SERVER] Health check request:', {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  res.json({ status: 'OK', message: 'VibeCalendar API is running' });
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
  
  // Check if token is expired (with 5-minute buffer)
  if (session.tokens.expiry_date && session.tokens.expiry_date <= Date.now() + 5 * 60 * 1000) {
    console.log('⚠️ [SERVER] Session expired or expiring soon:', sessionId.substring(0, 8) + '...');
    
    // Try to refresh the token first
    try {
      await refreshTokenIfNeeded(sessionId, session);
      
      // Check if session still exists after refresh attempt
      if (!sessions.has(sessionId)) {
        return res.json({
          valid: false,
          message: 'Session expired and refresh failed'
        });
      }
    } catch (error) {
      console.error('❌ [SERVER] Token refresh failed during validation:', error.message);
    sessions.delete(sessionId);
    await saveSessions();
    
    return res.json({
      valid: false,
      message: 'Session expired'
    });
    }
  }
  
  // Try to refresh token if needed
  try {
    await refreshTokenIfNeeded(sessionId, session);
    
    if (!sessions.has(sessionId)) {
      return res.json({
        valid: false,
        message: 'Session refresh failed'
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
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash-exp', prompt: 'Hello, this is a test message.' });
    
    console.log('✅ [SERVER] AI health check successful');
    res.json({
      status: 'OK',
      message: 'AI service is available',
      aiAvailable: true,
      model: 'gemini-1.5-flash',
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
    
    // Create a session
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    sessions.set(sessionId, { tokens, createdAt: new Date() });
    
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
  
  console.log('🔄 [SERVER] Fetching user information:', {
    sessionId: sessionId.substring(0, 8) + '...',
    ip: req.ip
  });
  
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
    
    console.log('✅ [SERVER] User information retrieved:', {
      sessionId: sessionId.substring(0, 8) + '...',
      name: userInfo.name,
      email: userInfo.email.substring(0, 20) + '...',
      timezone: userInfo.timezone
    });
    
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
        
        console.log('✅ [SERVER] User information retrieved (fallback):', {
          sessionId: sessionId.substring(0, 8) + '...',
          name: userInfo.name,
          email: userInfo.email.substring(0, 20) + '...',
          timezone: userInfo.timezone
        });
        
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
  const { timeMin, timeMax } = req.query;
  const sessionId = req.headers['x-session-id'];
  
  console.log('🔄 [SERVER] Fetching calendar events:', {
    sessionId: sessionId.substring(0, 8) + '...',
    timeMin,
    timeMax,
    ip: req.ip
  });
  
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    console.log('🌐 [SERVER] Making Google Calendar API call...', {
      sessionId: sessionId.substring(0, 8) + '...',
      calendarId: 'primary',
      timeMin,
      timeMax
    });
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    console.log('✅ [SERVER] Google Calendar API response:', {
      sessionId: sessionId.substring(0, 8) + '...',
      eventCount: response.data.items?.length || 0,
      nextPageToken: response.data.nextPageToken ? 'present' : 'none'
    });
    
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

// AI-powered event scheduling
app.post('/api/ai/schedule', aiLimiter, requireAuth, async (req, res) => {
  const { description, preferences, existingEvents, timezone } = req.body;
  const sessionId = req.headers['x-session-id'];
  
  console.log('🔄 [SERVER] AI scheduling request:', {
    description: description ? description.substring(0, 50) + '...' : 'none',
    preferences: preferences ? preferences.substring(0, 50) + '...' : 'none',
    existingEventsCount: existingEvents?.length || 0,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  // Check if Gemini API key is configured
  if (!geminiApiKey) {
    console.log('⚠️ [SERVER] No Gemini API key configured, using fallback response');
    return res.json({
      success: true,
      suggestion: {
        suggestedTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        duration: "01:00",
        title: description || "New Event",
        description: "Event scheduled via fallback",
        location: "To be determined",
        attendees: [],
        reminders: ["15 minutes before"],
        reasoning: "AI service unavailable - using default scheduling"
      }
    });
  }
  
  try {
    // Set up OAuth2 client for this session
    const session = sessions.get(sessionId);
    if (!session || !session.tokens) {
      console.error('❌ [SERVER] No valid session found for AI scheduling:', {
        sessionId: sessionId.substring(0, 8) + '...',
        hasSession: !!session,
        hasTokens: !!session?.tokens
      });
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    oauth2Client.setCredentials(session.tokens);
    
    // Get user's calendar events for context
    let calendarContext = '';
    if (existingEvents && existingEvents.length > 0) {
      console.log('📅 [SERVER] Available events for context:', existingEvents.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start.dateTime || event.start.date
      })));
      
      calendarContext = `Existing events: ${existingEvents.map(event => 
        `ID: ${event.id}, Title: ${event.summary}, Time: ${event.start.dateTime || event.start.date}`
      ).join(', ')}`;
    }
    
    // Check for upcoming events within 5 minutes for Pomodoro suggestions
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    const upcomingSoon = existingEvents?.filter(event => {
      const eventTime = new Date(event.start.dateTime || event.start.date);
      return eventTime >= now && eventTime <= fiveMinutesFromNow;
    }) || [];
    
    if (upcomingSoon.length > 0) {
      calendarContext += `\n\nPOMODORO SUGGESTION: The user has ${upcomingSoon.length} upcoming event(s) within the next 5 minutes: ${upcomingSoon.map(event => 
        `${event.summary} at ${new Date(event.start.dateTime || event.start.date).toLocaleTimeString()}`
      ).join(', ')}. If the user seems stressed or mentions needing to prepare, you can suggest starting a Pomodoro timer to help them focus before their event.`;
    }
    
    // Function to check for overlapping events
    const checkForOverlaps = (suggestedEvents, existingEvents) => {
      const overlaps = [];
      const now = new Date();
      
      // Filter existing events to only include future events (within next 30 days)
      const futureEvents = existingEvents.filter(existingEvent => {
        const existingStart = new Date(existingEvent.start.dateTime || existingEvent.start.date);
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        return existingStart >= now && existingStart <= thirtyDaysFromNow;
      });
      
      console.log('🔍 [SERVER] Overlap check details:', {
        totalExistingEvents: existingEvents.length,
        futureEventsCount: futureEvents.length,
        suggestedEventsCount: suggestedEvents.length,
        now: now.toISOString(),
        thirtyDaysFromNow: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      
      suggestedEvents.forEach(suggestedEvent => {
        const suggestedStart = new Date(suggestedEvent.startTime);
        const suggestedEnd = new Date(suggestedEvent.endTime);
        
        futureEvents.forEach(existingEvent => {
          const existingStart = new Date(existingEvent.start.dateTime || existingEvent.start.date);
          const existingEnd = new Date(existingEvent.end.dateTime || existingEvent.end.date);
          
          // Check if events overlap
          if (suggestedStart < existingEnd && suggestedEnd > existingStart) {
            overlaps.push({
              suggestedEvent: suggestedEvent,
              conflictingEvent: existingEvent,
              overlapType: suggestedStart < existingStart ? 'starts_before' : 
                          suggestedEnd > existingEnd ? 'ends_after' : 'completely_overlaps'
            });
          }
        });
      });
      
      return overlaps;
    };
    
    // Create AI prompt for scheduling
    const userTimezone = timezone || 'UTC';
    const currentTimeInUserTZ = new Date().toLocaleString('en-US', { timeZone: userTimezone });
    
    // Detect user's language
    const detectedLanguage = detectLanguage(description);
    
    const prompt = `
You are Vibe, a friendly personal assistant. Respond in the same language as the user.

CONTEXT:
User message: ${description}
User timezone: ${userTimezone}
Current time: ${currentTimeInUserTZ}
${calendarContext ? `Calendar context: ${calendarContext}` : ''}

AVAILABLE ACTIONS:
${generateActionParameterPrompt()}

RESPONSE FORMAT:
You must respond with ONLY a JSON object in this exact format:
{
  "actions": [
    {
      "action": "action_name",
      "parameters": { /* action parameters */ }
    }
  ],
  "message": "Your response to the user"
}

OR for no actions:
{
  "actions": [],
  "message": "Your response to the user"
}

IMPORTANT: Respond with ONLY the JSON object, no additional text before or after.

RULES:
- Use actions only for event management requests
- Answer general questions naturally
- Be conversational and helpful
- Use the user's timezone for dates
- Provide startTime and endTime in ISO format for events
- Maintain conversation context naturally in your responses
`;

    console.log('🤖 [SERVER] Making Google Gemini API call...', {
      promptLength: prompt.length,
      model: "gemini-2.0-flash-exp",
      detectedLanguage: detectedLanguage,
      userInput: description.substring(0, 50) + '...'
    });

    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash-exp', prompt });
    
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('✅ [SERVER] Google Gemini API response received:', {
      responseLength: aiResponse.length,
      responsePreview: aiResponse.substring(0, 100) + '...',
      fullResponse: aiResponse, // Log the full response for debugging
      hasCandidates: !!data.candidates,
      candidatesCount: data.candidates?.length || 0,
      hasContent: !!data.candidates?.[0]?.content,
      hasParts: !!data.candidates?.[0]?.content?.parts,
      partsCount: data.candidates?.[0]?.content?.parts?.length || 0,
      hasText: !!data.candidates?.[0]?.content?.parts?.[0]?.text,
      timestamp: new Date().toISOString()
    });
    
    // Try to parse the response as JSON, with fallback handling
    let aiResponseData;
    try {
      // Remove Markdown code block fencing if present
      let cleanResponse = aiResponse.trim();
      
      // Look for JSON at the end of the response (after ```json or ```)
      const jsonMatch = cleanResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```$/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[1];
      } else {
        // If no code block, try to find JSON at the end
        const lastBraceIndex = cleanResponse.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
          const firstBraceIndex = cleanResponse.indexOf('{');
          if (firstBraceIndex !== -1 && firstBraceIndex < lastBraceIndex) {
            cleanResponse = cleanResponse.substring(firstBraceIndex, lastBraceIndex + 1);
          }
        }
      }
      
      aiResponseData = JSON.parse(cleanResponse);
      
      console.log('✅ [SERVER] AI response parsed successfully:', {
        actions: aiResponseData.actions?.length || 0,
        hasMessage: !!aiResponseData.message,
        actionsList: aiResponseData.actions?.map(a => a.action) || []
      });
      
      // Process multiple actions if requested
      if (aiResponseData.actions && aiResponseData.actions.length > 0) {
        console.log('🔄 [SERVER] Processing AI actions:', {
          actionCount: aiResponseData.actions.length,
          actions: aiResponseData.actions.map(a => a.action)
        });
        
        const actionResults = [];
        let requiresConfirmation = false;
        
        // Process each action sequentially
        for (const actionRequest of aiResponseData.actions) {
          try {
            const actionResult = await processAction(
              actionRequest.action, 
              actionRequest.parameters, 
              sessionId, 
              oauth2Client
            );
            
            actionResults.push({
              action: actionRequest.action,
              parameters: actionRequest.parameters,
              success: actionResult.success,
              message: actionResult.message,
              requiresConfirmation: actionResult.requiresConfirmation
            });
            
            // If any action requires confirmation, mark the whole response as requiring confirmation
            if (actionResult.requiresConfirmation) {
              requiresConfirmation = true;
            }
            
            console.log('✅ [SERVER] Action processed:', {
              action: actionRequest.action,
              success: actionResult.success,
              requiresConfirmation: actionResult.requiresConfirmation,
              message: actionResult.message
            });
          } catch (error) {
            console.error('❌ [SERVER] Action failed:', {
              action: actionRequest.action,
              error: error.message
            });
            
            actionResults.push({
              action: actionRequest.action,
              parameters: actionRequest.parameters,
              success: false,
              message: `Failed to ${actionRequest.action}: ${error.message}`,
              requiresConfirmation: false
            });
          }
        }
        
        // Return all action results along with AI's message
        return res.json({
          success: true,
          aiMessage: aiResponseData.message,
          actions: aiResponseData.actions.map(a => a.action),
          actionResults: actionResults,
          requiresConfirmation: requiresConfirmation
        });
      } else {
        // Just chatting - return AI's message
        console.log('💬 [SERVER] AI is just chatting, no actions requested');
        
        return res.json({
          success: true,
          aiMessage: aiResponseData.message,
          actions: [],
          actionResults: [],
          requiresConfirmation: false
        });
      }
    } catch (parseError) {
      console.error('❌ [SERVER] Failed to parse Gemini response as JSON:', {
        error: parseError.message,
        parseErrorStack: parseError.stack,
        responseLength: aiResponse.length,
        responsePreview: aiResponse.substring(0, 500) + '...',
        responseEnd: aiResponse.substring(-200),
        fullResponse: aiResponse, // Log the full response for debugging
        requestData: {
          description: description ? description.substring(0, 100) + '...' : 'none',
          preferences: preferences ? preferences.substring(0, 100) + '...' : 'none',
          timezone: timezone || 'not provided',
          detectedLanguage: detectLanguage(description)
        },
        timestamp: new Date().toISOString()
      });
      // Return a structured error response
      return res.status(500).json({ 
        error: 'AI response format error',
        details: 'The AI response could not be parsed as valid JSON. This might be due to an unexpected response format from the AI service.',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ [SERVER] AI scheduling error:', {
      error: error.message,
      code: error.code,
      status: error.status,
      statusCode: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestData: {
        description: description ? description.substring(0, 100) + '...' : 'none',
        preferences: preferences ? preferences.substring(0, 100) + '...' : 'none',
        timezone: timezone || 'not provided',
        detectedLanguage: detectLanguage(description)
      },
      stack: error.stack,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to generate scheduling suggestion';
    let errorDetails = '';
    let statusCode = 500;
    
    if (error.message.includes('fetch failed') || error.message.includes('network')) {
      errorMessage = 'AI service temporarily unavailable';
      errorDetails = 'Network connectivity issue with AI service. Please try again later.';
      statusCode = 503;
    } else if (error.message.includes('API key') || error.message.includes('authentication')) {
      errorMessage = 'AI service configuration error';
      errorDetails = 'Please check the AI service configuration.';
      statusCode = 500;
    } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
      errorMessage = 'AI service rate limit exceeded';
      errorDetails = 'Too many requests to AI service. Please wait a moment and try again.';
      statusCode = 429;
    } else if (error.response?.status === 400) {
      errorMessage = 'Invalid request to AI service';
      errorDetails = 'The request format was incorrect.';
      statusCode = 400;
    } else if (error.response?.status === 401) {
      errorMessage = 'AI service authentication failed';
      errorDetails = 'Please check the AI service credentials.';
      statusCode = 401;
    } else if (error.response?.status === 403) {
      errorMessage = 'AI service access denied';
      errorDetails = 'Insufficient permissions for AI service.';
      statusCode = 403;
    } else if (error.response?.status >= 500) {
      errorMessage = 'AI service internal error';
      errorDetails = 'The AI service is experiencing issues. Please try again later.';
      statusCode = 502;
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: errorDetails,
      retryAfter: statusCode === 429 ? 60 : 30,
      timestamp: new Date().toISOString()
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

// Smart scheduling with AI
app.post('/api/ai/smart-schedule', aiLimiter, requireAuth, async (req, res) => {
  const { description, preferences, constraints } = req.body;
  const sessionId = req.headers['x-session-id'];
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.log('🔄 [SERVER] Smart scheduling request:', {
    requestId,
    sessionId: sessionId.substring(0, 8) + '...',
    description: description ? description.substring(0, 50) + '...' : 'none',
    preferences: preferences ? preferences.substring(0, 50) + '...' : 'none',
    constraints: constraints ? Object.keys(constraints) : 'none',
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  // Log full request details
  console.log('📋 [SERVER] Full smart scheduling request details:', {
    requestId,
    description: description,
    preferences: preferences,
    constraints: constraints,
    requestBody: req.body
  });
  
  try {
    // Get available time slots
    const timeSlots = await findAvailableTimeSlots(constraints, oauth2Client);
    
    console.log('✅ [SERVER] Available time slots found:', {
      sessionId: sessionId.substring(0, 8) + '...',
      timeSlotsCount: timeSlots.length
    });
    
    // Use AI to select the best time slot
    const prompt = `
Given these available time slots and the event description, select the best time:

Event: ${description}
Preferences: ${preferences}
Available Slots: ${JSON.stringify(timeSlots)}

Select the best time slot and provide reasoning. Respond in JSON format:
{
  "selectedSlot": "YYYY-MM-DDTHH:MM:SS",
  "reasoning": "Why this slot was chosen"
}
`;

    console.log('🤖 [SERVER] AI Prompt for smart scheduling:', {
      requestId,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''),
      fullPrompt: prompt,
      model: 'gemini-2.0-flash-exp',
      timeSlotsCount: timeSlots.length
    });

    const aiStartTime = Date.now();
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash-exp', prompt });
    const aiEndTime = Date.now();
    const responseTime = aiEndTime - aiStartTime;
    
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('✅ [SERVER] Google Gemini API smart scheduling response received:', {
      requestId,
      sessionId: sessionId.substring(0, 8) + '...',
      responseLength: aiResponse.length,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    });
    
    // Log the full AI response
    console.log('🤖 [SERVER] AI Response for smart scheduling:', {
      requestId,
      responseLength: aiResponse.length,
      responsePreview: aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''),
      fullResponse: aiResponse
    });
    
    // Try to parse the response as JSON, with fallback handling
    let selection;
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
      
      console.log('🔧 [SERVER] Attempting to parse smart scheduling response:', {
        requestId,
        originalResponseLength: aiResponse.length,
        cleanedResponseLength: cleanResponse.length,
        cleanedResponsePreview: cleanResponse.substring(0, 300) + (cleanResponse.length > 300 ? '...' : '')
      });
      
      selection = JSON.parse(cleanResponse);
      console.log('✅ [SERVER] Smart scheduling response parsed successfully:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        selectedSlot: selection.selectedSlot,
        reasoning: selection.reasoning,
        parsedSelection: selection
      });
    } catch (parseError) {
      console.error('❌ [SERVER] Failed to parse smart scheduling response as JSON:', {
        requestId,
        sessionId: sessionId.substring(0, 8) + '...',
        error: parseError.message,
        errorStack: parseError.stack,
        originalResponse: aiResponse,
        cleanedResponse: cleanResponse,
        timestamp: new Date().toISOString()
      });
      // Return a structured error response
      return res.status(500).json({ 
        error: 'AI response format error',
        details: 'The AI response could not be parsed as valid JSON',
        requestId: requestId
      });
    }
    
    const response = {
      success: true,
      selectedTime: selection.selectedSlot,
      reasoning: selection.reasoning
    };
    
    console.log('✅ [SERVER] Smart scheduling response sent:', {
      requestId,
      response: response
    });
    
    res.json(response);
    
      } catch (error) {
      console.error('❌ [SERVER] Smart scheduling error:', {
      requestId,
        error: error.message,
      errorStack: error.stack,
      errorCode: error.code,
      errorStatus: error.status,
        sessionId: sessionId.substring(0, 8) + '...',
      ip: req.ip,
      timestamp: new Date().toISOString()
      });
      
      // Provide more specific error messages based on the error type
      let errorMessage = 'Failed to perform smart scheduling';
      let errorDetails = '';
      
      if (error.message.includes('fetch failed')) {
        errorMessage = 'AI service temporarily unavailable';
        errorDetails = 'Network connectivity issue with AI service. Please try again later.';
      } else if (error.message.includes('API key')) {
        errorMessage = 'AI service configuration error';
        errorDetails = 'Please check the AI service configuration.';
      } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
        errorMessage = 'AI service rate limit exceeded';
        errorDetails = 'Too many requests to AI service. Please wait a moment and try again.';
      }
      
      const errorResponse = {
        error: errorMessage,
        details: errorDetails,
        retryAfter: 30, // Suggest retry after 30 seconds
        requestId: requestId
      };
      
      console.log('❌ [SERVER] Smart scheduling error response sent:', {
        requestId,
        errorResponse: errorResponse
      });
      
      res.status(500).json(errorResponse);
    }
});

// AI Pomodoro suggestion endpoint
app.post('/api/ai/pomodoro-suggestion', aiLimiter, requireAuth, async (req, res) => {
  const { upcomingEvents, userLanguage, initializeSession } = req.body;
  const sessionId = req.headers['x-session-id'];
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
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
}`;

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

  // Log the prompt being sent to AI
  console.log('🤖 [SERVER] AI Prompt sent:', {
    requestId,
    promptLength: prompt.length,
    promptPreview: prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''),
    isInitialized: !initializeSession,
    model: 'gemini-2.0-flash-exp'
  });
  
  try {
    const aiStartTime = Date.now();
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash-exp', prompt });
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
app.delete('/api/calendar/events/:eventId', requireAuth, async (req, res) => {
  const { eventId } = req.params;
  const sessionId = req.headers['x-session-id'];
  
  console.log('🔄 [SERVER] Deleting calendar event:', {
    sessionId: sessionId.substring(0, 8) + '...',
    eventId,
    ip: req.ip
  });
  
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    console.log('🌐 [SERVER] Making Google Calendar API call to delete event...', {
      sessionId: sessionId.substring(0, 8) + '...',
      calendarId: 'primary',
      eventId
    });
    
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
      sendUpdates: 'all'
    });
    
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
    res.status(500).json({ error: 'Failed to delete calendar event' });
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