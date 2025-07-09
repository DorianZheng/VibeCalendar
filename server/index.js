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

async function geminiGenerateContent({ model, prompt }) {
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
    timestamp: new Date().toISOString()
  });
  
  try {
    const response = await axios.post(url, body, options);
    console.log('✅ [SERVER] Gemini API request successful:', {
      status: response.status,
      statusText: response.statusText,
      responseSize: JSON.stringify(response.data).length,
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
      timestamp: new Date().toISOString()
    });
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
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash', prompt: 'Hello' });
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
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash', prompt: 'Hello, this is a test message.' });
    
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
app.post('/api/ai/schedule', aiLimiter, async (req, res) => {
  const { description, preferences, existingEvents, timezone } = req.body;
  
  console.log('🔄 [SERVER] AI scheduling request:', {
    description: description ? description.substring(0, 50) + '...' : 'none',
    preferences: preferences ? preferences.substring(0, 50) + '...' : 'none',
    existingEventsCount: existingEvents?.length || 0,
    ip: req.ip
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
    // Get user's calendar events for context
    let calendarContext = '';
    if (existingEvents && existingEvents.length > 0) {
      calendarContext = `Existing events: ${existingEvents.map(event => 
        `${event.summary} on ${event.start.dateTime || event.start.date}`
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
    
    // Create AI prompt for scheduling
    const userTimezone = timezone || 'UTC';
    const currentTimeInUserTZ = new Date().toLocaleString('en-US', { timeZone: userTimezone });
    
    // Detect user's language
    const detectedLanguage = detectLanguage(description);
    
    const prompt = `
You are a friendly, helpful AI assistant helping to schedule events. You should be conversational, warm, and extremely human-friendly in your responses. First, determine if the user actually wants to schedule an event or if they're just asking questions. You can suggest multiple events at once if the user's request involves multiple activities, recurring events, or multi-day events.

Event Description: ${description}
User Preferences: ${preferences}
User Timezone: ${userTimezone}
Current Time in User's Timezone: ${currentTimeInUserTZ}
Detected Language: ${detectedLanguage}
${calendarContext}

IMPORTANT INSTRUCTIONS:
1. Analyze the user's intent first. Only suggest scheduling if they explicitly want to add an event to their calendar.
2. Always provide suggested times in the user's timezone (${userTimezone}).
3. When suggesting times, consider the user's current local time.
4. DETECT THE LANGUAGE the user is speaking in and RESPOND IN THE SAME LANGUAGE.
5. If the user writes in Chinese, respond in Chinese. If they write in English, respond in English. If they write in Spanish, respond in Spanish, etc.
6. CRITICAL: Use the SAME LANGUAGE as the user's input for ALL event details (title, description, location, reasoning).
7. DETECTED LANGUAGE: ${detectedLanguage} - Use this language for all responses and event details.
8. You can suggest multiple events if the user's request involves multiple activities (e.g., "schedule a team meeting and a client call").
9. For recurring events, create multiple events with the same title but different dates.
10. For multi-day events, create separate events for each day or use the "multiDay" flag.
11. For events spanning multiple days, set "multiDay": true and provide start and end dates.
12. RESPONSE STYLE: Be extremely conversational, friendly, and helpful. Use natural language that feels like talking to a helpful friend.
13. MESSAGE FORMAT: Write messages that are easy to read, well-formatted, and provide clear, actionable information.

Please provide a JSON response with the following structure:
{
  "shouldSchedule": true/false,
  "message": "Explanation of your response or answer to their question (in the same language as the user's input)",
  "events": [
    {
      "suggestedTime": "YYYY-MM-DDTHH:MM:SS" (in user's timezone),
      "endTime": "YYYY-MM-DDTHH:MM:SS" (for multi-day events, in user's timezone),
      "duration": "HH:MM",
      "title": "Event title" (MUST be in the same language as the user's input),
      "description": "Detailed description" (MUST be in the same language as the user's input),
      "location": "Location if applicable" (MUST be in the same language as the user's input),
      "attendees": ["email1@example.com", "email2@example.com"],
      "reminders": ["15 minutes before", "1 hour before"] (or equivalent in user's language),
      "reasoning": "Explanation of why this time was chosen" (MUST be in the same language as the user's input),
      "multiDay": false (set to true for events spanning multiple days),
      "recurring": false (set to true for recurring events)
    }
  ] (only if shouldSchedule is true, can contain multiple events)
}

Examples:
- If user says "What time is it?" → shouldSchedule: false, message: "Hey there! It's currently ${currentTimeInUserTZ} in your timezone (${userTimezone}). Perfect time to plan your day! 😊"
- If user says "Schedule a meeting tomorrow" → shouldSchedule: true, provide events array with one event
- If user says "Schedule team meeting and client call tomorrow" → shouldSchedule: true, provide events array with two events
- If user says "Schedule daily standup meetings this week" → shouldSchedule: true, provide events array with 5 events (Monday-Friday)
- If user says "Schedule a 3-day conference next week" → shouldSchedule: true, provide events array with 3 events (one for each day) or one multi-day event
- If user says "Remind me to take fish oil daily" → shouldSchedule: true, create multiple events for the next 30 days
- If user says "How's the weather?" → shouldSchedule: false, message: "I'd love to help with the weather, but I'm your calendar assistant! I can help you schedule meetings, appointments, or any events you need. What would you like to plan? 🌟"
- If user says "I'm stressed about my upcoming meeting" and has an event in 5 minutes → shouldSchedule: false, message: "I see you have a meeting coming up soon! Would you like to start a Pomodoro timer to help you focus and prepare? It's a great way to stay productive and calm before important events! 🍅⏰"
- If user says "I need to prepare for my presentation" and has an event in 5 minutes → shouldSchedule: false, message: "Perfect timing! I notice you have a presentation coming up. How about starting a Pomodoro timer? It'll help you focus and make the most of your preparation time! 🍅✨"

CHINESE EXAMPLES:
- If user says "什么时候开会？" → shouldSchedule: false, message: "你好！我需要一些信息来帮你安排会议。请告诉我会议的主题、参与者和你希望的时间。这样我就能为你找到最合适的时间了！ 😊"
- If user says "明天下午2点开会" → shouldSchedule: true, provide events array with one event in ${userTimezone} with Chinese titles and descriptions
- If user says "安排本周的每日站会" → shouldSchedule: true, provide events array with 5 events (周一到周五) with Chinese titles like "每日站会"
- If user says "下周安排三天会议" → shouldSchedule: true, provide events array with 3 events with Chinese titles like "会议"
- If user says "我对即将到来的会议感到紧张" and has an event in 5 minutes → shouldSchedule: false, message: "我看到你很快就要开会了！要不要启动一个番茄钟来帮助你集中注意力做准备？这是保持高效和冷静的好方法！🍅⏰"
- If user says "我需要为演讲做准备" and has an event in 5 minutes → shouldSchedule: false, message: "时机正好！我注意到你很快就要演讲了。要不要启动一个番茄钟？它会帮助你集中注意力，充分利用准备时间！🍅✨"

SPANISH EXAMPLES:
- If user says "¿Cuándo es la reunión?" → shouldSchedule: false, message: "¡Hola! Necesito un poco más de información para ayudarte a programar la reunión. Por favor dime el tema, participantes y tu tiempo preferido. ¡Así podré encontrar el momento perfecto para ti! 😊"
- If user says "Programar reunión mañana" → shouldSchedule: true, provide events array with one event with Spanish titles like "Reunión"
- If user says "Programar reuniones diarias esta semana" → shouldSchedule: true, provide events array with 5 events with Spanish titles like "Reunión Diaria"
- If user says "Estoy estresado por mi próxima reunión" and has an event in 5 minutes → shouldSchedule: false, message: "¡Veo que tienes una reunión pronto! ¿Te gustaría iniciar un temporizador Pomodoro para ayudarte a concentrarte y prepararte? ¡Es una excelente manera de mantenerte productivo y tranquilo antes de eventos importantes! 🍅⏰"
- If user says "Necesito prepararme para mi presentación" and has an event in 5 minutes → shouldSchedule: false, message: "¡Momento perfecto! Noto que tienes una presentación pronto. ¿Qué tal si iniciamos un temporizador Pomodoro? ¡Te ayudará a concentrarte y aprovechar al máximo tu tiempo de preparación! 🍅✨"

Remember: CRITICAL - Use the EXACT SAME LANGUAGE as the user's input for ALL event details (title, description, location, reasoning)!
`;

    console.log('🤖 [SERVER] Making Google Gemini API call...', {
      promptLength: prompt.length,
      model: "gemini-2.0-flash",
      detectedLanguage: detectedLanguage,
      userInput: description.substring(0, 50) + '...'
    });

    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash', prompt });
    
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('✅ [SERVER] Google Gemini API response received:', {
      responseLength: aiResponse.length,
      responsePreview: aiResponse.substring(0, 100) + '...',
      hasCandidates: !!data.candidates,
      candidatesCount: data.candidates?.length || 0,
      hasContent: !!data.candidates?.[0]?.content,
      hasParts: !!data.candidates?.[0]?.content?.parts,
      partsCount: data.candidates?.[0]?.content?.parts?.length || 0,
      hasText: !!data.candidates?.[0]?.content?.parts?.[0]?.text,
      timestamp: new Date().toISOString()
    });
    
    // Try to parse the response as JSON, with fallback handling
    let schedulingSuggestion;
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
      schedulingSuggestion = JSON.parse(cleanResponse);
      
      // Check if AI determined we should schedule events
      if (schedulingSuggestion.shouldSchedule) {
        console.log('✅ [SERVER] AI determined events should be scheduled:', {
          eventCount: schedulingSuggestion.events?.length || 0,
          events: schedulingSuggestion.events?.map(e => ({ title: e.title, time: e.suggestedTime })) || []
        });
        
        res.json({
          success: true,
          shouldSchedule: true,
          events: schedulingSuggestion.events || []
        });
      } else {
        console.log('💬 [SERVER] AI determined no events needed:', {
          message: schedulingSuggestion.message
        });
        
        res.json({
          success: true,
          shouldSchedule: false,
          message: schedulingSuggestion.message
        });
      }
    } catch (parseError) {
      console.error('❌ [SERVER] Failed to parse Gemini response as JSON:', {
        error: parseError.message,
        parseErrorStack: parseError.stack,
        responseLength: aiResponse.length,
        responsePreview: aiResponse.substring(0, 500) + '...',
        responseEnd: aiResponse.substring(-200),
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
  
  console.log('🔄 [SERVER] Creating calendar event:', {
    sessionId: sessionId.substring(0, 8) + '...',
    title,
    startTime,
    endTime,
    location,
    attendeesCount: attendees?.length || 0,
    reminders,
    ip: req.ip,
    requestBody: req.body
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
    
    console.log('🌐 [SERVER] Making Google Calendar API call to create event...', {
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
      }
    });
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all'
    });
    
    console.log('✅ [SERVER] Google Calendar API event created:', {
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
    console.error('❌ [SERVER] Create event error:', {
      error: error.message,
      status: error.code,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestData: {
        title,
        startTime,
        endTime,
        location,
        attendeesCount: attendees?.length || 0,
        reminders
      },
      sessionId: sessionId.substring(0, 8) + '...',
      title,
      ip: req.ip,
      stack: error.stack
    });
    res.status(500).json({ error: 'Failed to create calendar event' });
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
      model: 'gemini-2.0-flash',
      timeSlotsCount: timeSlots.length
    });

    const startTime = Date.now();
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash', prompt });
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
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
    model: 'gemini-2.0-flash'
  });
  
  try {
    const startTime = Date.now();
    const data = await geminiGenerateContent({ model: 'gemini-2.0-flash', prompt });
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
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