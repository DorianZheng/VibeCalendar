const { google } = require('googleapis');

// Global rate limiting for calendar operations
const calendarRateLimiter = new Map(); // sessionId -> lastOperationTime

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

module.exports = {
  toolHandlers,
  enforceCalendarRateLimit
}; 