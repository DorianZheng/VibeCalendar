import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import path from 'path';
import requestLogger from './middleware/requestLogger.js';
import { toolHandlers, enforceCalendarRateLimit } from './utils/tools.js';
import { generateGlobalSystemPrompt } from './utils/systemPrompt.js';
import { geminiGenerateContent, getModelStatus } from './utils/gemini.js';
import { compactConversationHistory } from './utils/conversationUtils.js';
import { parseAiResponse, processTool } from './utils/aiUtils.js';
import { saveSessions, cleanupExpiredSessions, initSessions, refreshTokenIfNeeded, getCurrentModel } from './utils/session.js';

// Load environment variables
dotenv.config();

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
    const systemPrompt = generateGlobalSystemPrompt(userTimezone, toolHandlers);

    // Update user session with new conversation history
    userSession.conversationHistory = updatedConversationHistory;
    sessions.set(sessionId, userSession);
    await saveSessions();

    if (wasCancelled) {
      // Handle cancellation with AI
      const userTimezone = userSession.timezone || 'UTC';
      const cancellationResponse = await callModel({
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
    const summarySystemPrompt = generateGlobalSystemPrompt(userTimezone, toolHandlers);
    const finalResponse = await callModel({
      conversationHistory: updatedConversationHistory,
      currentMessage: '',
      systemPrompt,
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

const app = express();
const PORT = process.env.PORT || 50001;

// Trust proxy for rate limiting (fixes X-Forwarded-For header error)
app.set('trust proxy', 1);

// Add request logging middleware
app.use(requestLogger);

// Persistent session store
// Use process.env.SESSIONS_PATH for the sessions file path
// Make sure to set SESSIONS_PATH in your environment or .env file, e.g. SESSIONS_PATH=./server/sessions.json
const sessionsFilePath = process.env.SESSIONS_PATH;
const sessions = await initSessions(sessionsFilePath);
// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function registerGracefulShutdown(server) {
process.on('SIGINT', async () => {
  console.log('🛑 [SERVER] Shutting down gracefully...');
  await saveSessions();
    if (server && server.close) {
  server.close(() => {
    console.log('✅ [SERVER] Server closed');
    process.exit(0);
  });
    } else {
      process.exit(0);
    }
});

process.on('SIGTERM', async () => {
  console.log('🛑 [SERVER] Shutting down gracefully...');
  await saveSessions();
    if (server && server.close) {
  server.close(() => {
    console.log('✅ [SERVER] Server closed');
    process.exit(0);
  });
    } else {
      process.exit(0);
    }
});
}

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
    const webhookUrl = `${process.env.CLIENT_URL || 'http://localhost:30001'}/api/calendar/webhook/${sessionId}`;

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
}

// Unified model call function with automatic model switching
async function callModel({
  conversationHistory = [],
  currentMessage,
  systemPrompt = null,
  sessionId = null,
  options = {}
}) {
  // Always use getCurrentModel
  const currentModel = getCurrentModel(sessionId);
  const result = await geminiGenerateContent({
    model: currentModel,
    conversationHistory,
    currentMessage,
    systemPrompt,
    sessionId,
    ...options
  });
  // If a fallback model was used, update the session's preferredModel
  if (result.fallbackModel && sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.preferredModel = result.fallbackModel;
    sessions.set(sessionId, session);
    await saveSessions();
    console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${result.fallbackModel}`);
  }
  return result.data;
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
    modelStatus: getModelStatus()
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
      model: modelResult.fallbackModel,
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
    const systemPrompt = generateGlobalSystemPrompt(userTimezone, toolHandlers);

    // Get conversation history
    let fullConversationHistory = userSession.conversationHistory || [];

    // Apply compaction if needed
    fullConversationHistory = await compactConversationHistory(fullConversationHistory, {
      maxMessages: 40,
      maxTotalLength: 25000,
      preserveRecentMessages: 15,
      useAI: true,
      model: getCurrentModel(sessionId),
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
            conversationHistory: currentConversationHistory,
            currentMessage: currentMessage,
            systemPrompt: systemPrompt,
            sessionId: sessionId,
            requestId: requestId,
            options: { enableModelSwitching: true, enableCompaction: currentMessage === '' }
          });

          const aiResponseText = modelResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
              const toolResult = await processTool(toolRequest.tool, toolRequest.parameters, sessionId, oauth2Client, toolHandlers);
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
        const toolResult = await processTool(toolRequest.tool, toolRequest.parameters, sessionId, oauth2Client, toolHandlers);
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

// Debug endpoint to clear conversation history for the current session
app.post('/api/debug/clear-history', requireAuth, async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: 'No valid session found' });
  }
  const session = sessions.get(sessionId);
  console.log('💾 [SERVER] Clearing conversation history for sessionId: ', sessionId, 'conversationHistory: ', session.conversationHistory);
  session.conversationHistory = [];
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

registerGracefulShutdown(server);
