const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Google Calendar API setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'VibeCalendar API is running' });
});

// Google Calendar OAuth endpoints
app.get('/api/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ];
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
  
  res.json({ authUrl });
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    res.json({ 
      success: true, 
      message: 'Google Calendar connected successfully',
      tokens 
    });
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Google' });
  }
});

// Get user's calendar events
app.get('/api/calendar/events', async (req, res) => {
  try {
    const { timeMin, timeMax } = req.query;
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Calendar API error:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// AI-powered event scheduling
app.post('/api/ai/schedule', async (req, res) => {
  try {
    const { description, preferences, existingEvents } = req.body;
    
    // Get user's calendar events for context
    let calendarContext = '';
    if (existingEvents && existingEvents.length > 0) {
      calendarContext = `Existing events: ${existingEvents.map(event => 
        `${event.summary} on ${event.start.dateTime || event.start.date}`
      ).join(', ')}`;
    }
    
    // Create AI prompt for scheduling
    const prompt = `
You are an AI assistant helping to schedule events. Given the following information, suggest the best time and details for the event:

Event Description: ${description}
User Preferences: ${preferences}
${calendarContext}

Please provide a JSON response with the following structure:
{
  "suggestedTime": "YYYY-MM-DDTHH:MM:SS",
  "duration": "HH:MM",
  "title": "Event title",
  "description": "Detailed description",
  "location": "Location if applicable",
  "attendees": ["email1@example.com", "email2@example.com"],
  "reminders": ["15 minutes before", "1 hour before"],
  "reasoning": "Explanation of why this time was chosen"
}

Consider:
- User's preferences and availability
- Existing calendar conflicts
- Optimal timing for the type of event
- Travel time if location is involved
- Buffer time between events
`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const result = await model.generateContent([
      "You are a helpful AI assistant that helps users schedule events optimally. Always respond with valid JSON.",
      prompt
    ]);
    
    const aiResponse = result.response.text();
    
    // Try to parse the response as JSON, with fallback handling
    let schedulingSuggestion;
    try {
      schedulingSuggestion = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON:', aiResponse);
      // Return a structured error response
      return res.status(500).json({ 
        error: 'AI response format error',
        details: 'The AI response could not be parsed as valid JSON'
      });
    }
    
    res.json({
      success: true,
      suggestion: schedulingSuggestion
    });
    
  } catch (error) {
    console.error('AI scheduling error:', error);
    res.status(500).json({ error: 'Failed to generate scheduling suggestion' });
  }
});

// Create calendar event
app.post('/api/calendar/events', async (req, res) => {
  try {
    const { title, description, startTime, endTime, location, attendees, reminders } = req.body;
    
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
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all'
    });
    
    res.json({
      success: true,
      event: response.data
    });
    
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

// Smart scheduling with AI
app.post('/api/ai/smart-schedule', async (req, res) => {
  try {
    const { description, preferences, constraints } = req.body;
    
    // Get available time slots
    const timeSlots = await findAvailableTimeSlots(constraints);
    
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

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const result = await model.generateContent([
      "You are an AI assistant that helps select optimal meeting times.",
      prompt
    ]);
    
    const aiResponse = result.response.text();
    
    // Try to parse the response as JSON, with fallback handling
    let selection;
    try {
      selection = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON:', aiResponse);
      // Return a structured error response
      return res.status(500).json({ 
        error: 'AI response format error',
        details: 'The AI response could not be parsed as valid JSON'
      });
    }
    
    res.json({
      success: true,
      selectedTime: selection.selectedSlot,
      reasoning: selection.reasoning
    });
    
  } catch (error) {
    console.error('Smart scheduling error:', error);
    res.status(500).json({ error: 'Failed to perform smart scheduling' });
  }
});

// Helper function to find available time slots
async function findAvailableTimeSlots(constraints) {
  try {
    const { startDate, endDate, duration, workingHours } = constraints;
    
    // Get existing events in the date range
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    const events = response.data.items || [];
    
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
    
    return timeSlots;
  } catch (error) {
    console.error('Error finding time slots:', error);
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

app.listen(PORT, () => {
  console.log(`🚀 VibeCalendar server running on port ${PORT}`);
  console.log(`📅 Google Calendar API: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured'}`);
  console.log(`🤖 Google Gemini API: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);
}); 