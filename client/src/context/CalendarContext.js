import React, { createContext, useContext, useReducer, useEffect, useCallback, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

// Browser notification utility (only for Pomodoro timer)
const showPomodoroNotification = (title, message) => {
  if (!('Notification' in window)) {
    console.log('This browser does not support notifications');
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, {
      body: message,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'pomodoro-notification',
      requireInteraction: false,
      silent: false
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, {
          body: message,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'pomodoro-notification',
          requireInteraction: false,
          silent: false
        });
      }
    });
  }
};

const CalendarContext = createContext();

const initialState = {
  sessionId: null,
  isGoogleConnected: false,
  events: [],
  loading: false,
  error: null,
  aiSuggestions: [],
  sessionValidated: false,
  user: null
};

const calendarReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_EVENTS':
      return { ...state, events: action.payload };
    case 'ADD_EVENT':
      return { ...state, events: [...state.events, action.payload] };
    case 'UPDATE_EVENT':
      return {
        ...state,
        events: state.events.map(event =>
          event.id === action.payload.id ? action.payload : event
        )
      };
    case 'DELETE_EVENT':
      return {
        ...state,
        events: state.events.filter(event => event.id !== action.payload)
      };
    case 'SET_AI_SUGGESTIONS':
      return { ...state, aiSuggestions: action.payload };
    case 'CLEAR_AI_SUGGESTIONS':
      return { ...state, aiSuggestions: [] };
    case 'SET_GOOGLE_CONNECTED':
      return { ...state, isGoogleConnected: action.payload };
    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.payload, isGoogleConnected: true, sessionValidated: true };
    case 'CLEAR_SESSION':
      return { ...state, sessionId: null, isGoogleConnected: false, events: [], sessionValidated: false };
    case 'SET_SESSION_VALIDATED':
      return { ...state, sessionValidated: action.payload };
    case 'SET_USER':
      return { ...state, user: action.payload };
    default:
      return state;
  }
};

// Helper functions for localStorage
const saveSessionToStorage = (sessionId) => {
  try {
    localStorage.setItem('vibeCalendar_sessionId', sessionId);
    localStorage.setItem('vibeCalendar_connectedAt', new Date().toISOString());
  } catch (error) {
    console.error('Failed to save session to localStorage:', error);
  }
};

const getSessionFromStorage = () => {
  try {
    const sessionId = localStorage.getItem('vibeCalendar_sessionId');
    const connectedAt = localStorage.getItem('vibeCalendar_connectedAt');

    if (sessionId && connectedAt) {
      // Check if session is not too old (7 days)
      const connectedDate = new Date(connectedAt);
      const now = new Date();
      const daysDiff = (now - connectedDate) / (1000 * 60 * 60 * 24);

      if (daysDiff < 7) {
        return sessionId;
      } else {
        // Session is too old, clear it
        clearSessionFromStorage();
        return null;
      }
    }
    return null;
  } catch (error) {
    console.error('❌ [STORAGE] Failed to get session from localStorage:', error);
    return null;
  }
};

const clearSessionFromStorage = () => {
  try {
    localStorage.removeItem('vibeCalendar_sessionId');
    localStorage.removeItem('vibeCalendar_connectedAt');
  } catch (error) {
    console.error('❌ [STORAGE] Failed to clear session from localStorage:', error);
  }
};

export const CalendarProvider = ({ children }) => {
  const [state, dispatch] = useReducer(calendarReducer, initialState);
  const [isValidatingSession, setIsValidatingSession] = useState(false);
  const [lastApiCall, setLastApiCall] = useState({});
  const [rateLimitCooldown, setRateLimitCooldown] = useState(false);

  // Rate limiting helper
  const checkRateLimit = (endpoint) => {
    const now = Date.now();
    const lastCall = lastApiCall[endpoint] || 0;
    const minInterval = 1000; // 1 second minimum between calls to same endpoint

    if (now - lastCall < minInterval) {
      return false;
    }

    if (rateLimitCooldown) {
      return false;
    }

    setLastApiCall(prev => ({ ...prev, [endpoint]: now }));
    return true;
  };

  // Handle rate limiting
  const handleRateLimit = () => {
    setRateLimitCooldown(true);
    setTimeout(() => {
      setRateLimitCooldown(false);
    }, 30000); // 30 second cooldown
  };

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedSessionId = getSessionFromStorage();

    if (savedSessionId && !isValidatingSession) {
      // Set the session ID immediately to ensure axios headers are set
      dispatch({ type: 'SET_SESSION_ID', payload: savedSessionId });
      // Add a small delay to prevent race conditions during page load
      setTimeout(() => {
        validateSession(savedSessionId);
      }, 100);
    }
  }, []); // Only run once on mount

  // Validate session by making a test request
  const validateSession = async (sessionId) => {
    if (isValidatingSession) {
      return;
    }

    setIsValidatingSession(true);
    // Set sessionValidated to false while validating
    dispatch({ type: 'SET_SESSION_VALIDATED', payload: false });

    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      try {
        // Use the dedicated session validation endpoint instead of calendar events
        const response = await axios.get('/api/auth/session', {
          headers: { 'x-session-id': sessionId },
          timeout: 10000 // 10 second timeout
        });

        if (response.data.valid) {
          // Session is valid, ensure it's set in state
          dispatch({ type: 'SET_SESSION_ID', payload: sessionId });
          setIsValidatingSession(false);
          return;
        } else {
          // Session is invalid, clear it
          dispatch({ type: 'CLEAR_SESSION' });
          clearSessionFromStorage();
          setIsValidatingSession(false);
          return;
        }
      } catch (error) {
        retryCount++;

        if (retryCount > maxRetries) {
          // Final attempt failed, clear session
          dispatch({ type: 'CLEAR_SESSION' });
          clearSessionFromStorage();
          break;
        }

        // Wait before retrying (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    setIsValidatingSession(false);
  };

  // Configure axios to include session ID in headers
  useEffect(() => {
    if (state.sessionId) {
      axios.defaults.headers.common['x-session-id'] = state.sessionId;
    } else {
      delete axios.defaults.headers.common['x-session-id'];
    }
  }, [state.sessionId]);

  // Fetch events from Google Calendar - memoized to prevent infinite loops
  const fetchEvents = useCallback(async (startDate, endDate, showLoading = true) => {
    if (!state.sessionId) {
      return;
    }

    // Check rate limiting
    if (!checkRateLimit('fetchEvents')) {
      return;
    }

    try {
      if (showLoading) {
        dispatch({ type: 'SET_LOADING', payload: true });
      }

      const timeMin = startDate ? startDate.toISOString() : new Date().toISOString();
      const timeMax = endDate ? endDate.toISOString() : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const response = await axios.get('/api/calendar/events', {
        params: { timeMin, timeMax }
      });

      dispatch({ type: 'SET_EVENTS', payload: response.data.items || [] });
      // Clear any previous errors on successful fetch
      if (state.error) {
        dispatch({ type: 'SET_ERROR', payload: null });
      }
    } catch (error) {
      console.error('❌ [CLIENT] Error fetching calendar events:', {
        status: error.response?.status,
        message: error.response?.data?.error || error.message,
        sessionId: state.sessionId.substring(0, 8) + '...',
        url: error.config?.url
      });

      if (error.response?.status === 401) {
        // Session is invalid, clear it
        console.log('🔐 [CLIENT] Session expired, clearing session');
        dispatch({ type: 'CLEAR_SESSION' });
        clearSessionFromStorage();
        // Only show error once
        if (!state.error) {
          toast.error('Session expired. Please reconnect your Google Calendar.');
        }
      } else if (error.response?.status === 429) {
        // Rate limited, enter cooldown mode
        console.log('⏳ [CLIENT] Rate limited, entering cooldown mode');
        handleRateLimit();
        // Don't show error to user, just wait
      } else {
        // Other errors, only show once
        if (!state.error) {
          dispatch({ type: 'SET_ERROR', payload: 'Failed to fetch events' });
          // Don't show technical fetch errors to user, just log them
          console.error('Failed to fetch calendar events:', error.message);
        }
      }
    } finally {
      if (showLoading) {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
  }, [state.sessionId, state.error]);

  // Connect to Google Calendar
  const connectGoogleCalendar = async () => {
    // Check rate limiting
    if (!checkRateLimit('connectGoogleCalendar')) {
      return;
    }

    try {
      console.log('🔄 [CLIENT] Initiating Google Calendar OAuth...');
      const response = await axios.get('/api/auth/google');
      console.log('✅ [CLIENT] OAuth URL received, redirecting...');
      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error('❌ [CLIENT] Error connecting to Google Calendar:', {
        status: error.response?.status,
        message: error.response?.data?.error || error.message,
        url: error.config?.url
      });
      toast.error('Failed to connect to Google Calendar');
    }
  };

  // Handle OAuth callback
  const handleOAuthCallback = async (sessionId) => {
    if (sessionId && sessionId !== state.sessionId) {
      console.log('✅ [CLIENT] OAuth callback received, setting session ID:', sessionId.substring(0, 8) + '...');
      dispatch({ type: 'SET_SESSION_ID', payload: sessionId });
      saveSessionToStorage(sessionId);
    }
  };

  // Disconnect from Google Calendar
  const disconnectGoogleCalendar = async () => {
    console.log('🔌 [CLIENT] Disconnecting from Google Calendar');

    try {
      // Call server logout endpoint to revoke session
      if (state.sessionId) {
        await axios.post('/api/auth/logout');
        console.log('✅ [CLIENT] Server logout successful');
      }
    } catch (error) {
      console.log('⚠️ [CLIENT] Server logout failed, but continuing with client cleanup:', error.message);
    }

    // Clear client-side state regardless of server response
    dispatch({ type: 'CLEAR_SESSION' });
    clearSessionFromStorage();
  };

  // Create new event
  const createEvent = async (eventData, options = {}) => {
    const { skipRefresh = false, skipToast = false } = options;
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    if (!state.sessionId) {
      console.log('❌ [CLIENT] Cannot create event: No session ID');
      toast.error('Please connect your Google Calendar first');
      throw new Error('Not authenticated');
    }

    try {
      console.log('🔄 [CLIENT] Creating calendar event...', {
        requestId,
        title: eventData.title,
        description: eventData.description?.substring(0, 50) + (eventData.description?.length > 50 ? '...' : ''),
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        location: eventData.location,
        attendeesCount: eventData.attendees?.length || 0,
        attendees: eventData.attendees,
        reminders: eventData.reminders,
        sessionId: state.sessionId.substring(0, 8) + '...',
        fullEventData: eventData,
        skipRefresh,
        skipToast
      });

      dispatch({ type: 'SET_LOADING', payload: true });

      const apiStartTime = Date.now();
      const response = await axios.post('/api/calendar/events', eventData);
      const apiEndTime = Date.now();
      const responseTime = apiEndTime - apiStartTime;

      console.log('✅ [CLIENT] Event created successfully', {
        requestId,
        eventId: response.data.event?.id,
        title: response.data.event?.summary,
        sessionId: state.sessionId.substring(0, 8) + '...',
        responseTime: `${responseTime}ms`,
        responseData: response.data
      });

      dispatch({ type: 'ADD_EVENT', payload: response.data.event });

      // Only show toast and refresh if not skipped
      if (!skipToast) {
        toast.success('Event created successfully!');
      }

      // Refresh events to ensure we have the latest data (unless skipped)
      if (!skipRefresh) {
        setTimeout(() => fetchEvents(), 500);
      }

      return response.data.event;
    } catch (error) {
      console.error('❌ [CLIENT] Error creating event:', {
        requestId,
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.response?.data?.error || error.message,
        details: error.response?.data?.details,
        code: error.response?.data?.code,
        title: eventData.title,
        sessionId: state.sessionId.substring(0, 8) + '...',
        url: error.config?.url,
        requestData: error.config?.data,
        errorStack: error.stack,
        timestamp: new Date().toISOString()
      });

      if (error.response?.status === 401) {
        dispatch({ type: 'CLEAR_SESSION' });
        clearSessionFromStorage();
        toast.error('Please reconnect your Google Calendar');
      } else if (error.response?.status === 400) {
        dispatch({ type: 'SET_ERROR', payload: 'Invalid event data' });
        toast.error(error.response?.data?.error || 'Invalid event data');
      } else if (error.response?.status === 403) {
        dispatch({ type: 'SET_ERROR', payload: 'Permission denied' });
        toast.error('Permission denied - check your Google Calendar permissions');
      } else if (error.response?.status === 429) {
        dispatch({ type: 'SET_ERROR', payload: 'Rate limit exceeded' });
        toast.error('Too many requests. Please try again later.');
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to create event' });
        toast.error(error.response?.data?.error || 'Failed to create event');
      }
      throw error;
    }
  };

  // Get AI scheduling suggestions
  const getAISuggestions = async (description, preferences) => {
    // Check rate limiting
    if (!checkRateLimit('getAISuggestions')) {
      throw new Error('Rate limited - please wait before making another request');
    }

    try {
      console.log('🔄 [CLIENT] Getting AI scheduling suggestions...', {
        description: description.substring(0, 50) + '...',
        preferences: preferences.substring(0, 50) + '...'
      });

      dispatch({ type: 'SET_LOADING', payload: true });

      // Get user's timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const response = await axios.post('/api/ai/schedule', {
        description,
        preferences,
        timezone: userTimezone
      });

      console.log('✅ [CLIENT] AI response received', {
        tools: response.data.tools,
        aiMessage: response.data.aiMessage,
        requiresConfirmation: response.data.requiresConfirmation,
        toolResults: response.data.toolResults
      });

      // Handle multiple tools
      if (response.data.tools && response.data.tools.length > 0) {
        console.log('🔄 [CONTEXT] Processing AI tools response:', {
          toolsCount: response.data.tools.length,
          tools: response.data.tools,
          toolResults: response.data.toolResults,
          aiMessage: response.data.aiMessage?.substring(0, 100) + '...'
        });

        const toolResults = response.data.toolResults || [];
        const hasConfirmationRequired = toolResults.some(r => r.requiresConfirmation);

        // Track if we need to refresh events after processing all tools
        let needsEventRefresh = false;
        let createdEventCount = 0;

        // Process successful tools
        for (let i = 0; i < response.data.tools.length; i++) {
          const tool = response.data.tools[i];
          const result = toolResults[i];

          console.log(`🔄 [CONTEXT] Processing tool ${i + 1}/${response.data.tools.length}:`, {
            tool,
            result: result ? {
              success: result.success,
              hasEvent: !!result.event,
              eventId: result.event?.id,
              eventTitle: result.event?.summary,
              shouldRefreshEvents: result.shouldRefreshEvents,
              message: result.message
            } : 'No result'
          });

          if (result?.success) {
            if (tool === 'create_event' && result.event) {
              console.log('✅ [CONTEXT] Adding AI-created event to state:', {
                eventId: result.event.id,
                title: result.event.summary,
                startTime: result.event.start?.dateTime || result.event.start?.date
              });
              dispatch({ type: 'ADD_EVENT', payload: result.event });
              createdEventCount++;
              needsEventRefresh = true;
              // Don't show individual toasts for multiple events to avoid spam
              if (response.data.tools.length === 1) {
                toast.success(result.message || 'Event created successfully!');
              }
            } else if (tool === 'query_events' && result.events) {
              dispatch({ type: 'SET_EVENTS', payload: result.events });
            } else if (tool === 'update_event' && result.event) {
              dispatch({ type: 'UPDATE_EVENT', payload: result.event });
              toast.success(result.message || 'Event updated successfully!');
              needsEventRefresh = true;
            } else if (tool === 'delete_event' && (result.eventId || result.parameters?.eventId)) {
              // For delete events, we don't delete immediately if confirmation is required
              // The deletion will happen during confirmation
              if (!result.requiresConfirmation) {
                dispatch({ type: 'DELETE_EVENT', payload: result.eventId || result.parameters.eventId });
                toast.success(result.message || 'Event deleted successfully!');
                needsEventRefresh = true;
              }
            }

            // Check if the backend indicates we should refresh events
            if (result.shouldRefreshEvents) {
              needsEventRefresh = true;
            }
          } else if (result && !result.success) {
            toast.error(result.message || `Failed to ${tool}`);
          }
        }

        console.log('📊 [CONTEXT] Final tool processing summary:', {
          totalTools: response.data.tools?.length || 0,
          createdEventCount,
          needsEventRefresh,
          hasConfirmationRequired
        });

        if (needsEventRefresh) {
          // Refresh events once after all events are processed
          console.log('🔄 [CONTEXT] Refreshing events after AI tool execution:', {
            toolCount: response.data.tools?.length || 0,
            createdEventCount,
            needsEventRefresh
          });
          setTimeout(() => {
            console.log('🔄 [CONTEXT] Executing delayed event refresh');
            fetchEvents();
          }, 1500); // Increased delay to ensure Google Calendar API has propagated changes
        } else {
          console.log('ℹ️ [CONTEXT] No event refresh needed');
        }

        // Return response with multiple tools
        return {
          success: true,
          aiMessage: response.data.aiMessage,
          tools: response.data.tools,
          toolResults: toolResults,
          requiresConfirmation: hasConfirmationRequired
        };
      } else {
        // Just chatting - return AI's message
        return {
          success: true,
          aiMessage: response.data.aiMessage,
          tools: [],
          toolResults: []
        };
      }
    } catch (error) {
      console.error('❌ [CLIENT] Error getting AI suggestions:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        message: error.response?.data?.error || error.message,
        details: error.response?.data?.details,
        retryAfter: error.response?.data?.retryAfter,
        timestamp: error.response?.data?.timestamp,
        description: description.substring(0, 100) + '...',
        preferences: preferences.substring(0, 100) + '...',
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers,
        requestData: error.config?.data,
        errorStack: error.stack,
        clientTimestamp: new Date().toISOString()
      });

      // Provide more specific error messages based on the error type
      let errorMessage = 'Failed to get AI scheduling suggestions';
      let toastMessage = 'Failed to get AI scheduling suggestions';

      if (error.response?.status === 429) {
        errorMessage = 'AI service rate limit exceeded';
        toastMessage = 'Too many requests. Please wait a moment and try again.';
      } else if (error.response?.status === 503) {
        errorMessage = 'AI service temporarily unavailable';
        toastMessage = 'AI service is temporarily down. Please try again later.';
      } else if (error.response?.status === 401) {
        errorMessage = 'AI service authentication failed';
        toastMessage = 'AI service configuration error. Please check settings.';
      } else if (error.response?.status === 403) {
        errorMessage = 'AI service access denied';
        toastMessage = 'AI service access denied. Please check permissions.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
        toastMessage = error.response.data.details || error.response.data.error;
      }

      dispatch({ type: 'SET_ERROR', payload: errorMessage });
      throw error;
    }
  };



  // Update event
  const updateEvent = async (eventId, eventData) => {
    if (!state.sessionId) {
      console.log('❌ [CLIENT] Cannot update event: No session ID');
      toast.error('Please connect your Google Calendar first');
      throw new Error('Not authenticated');
    }

    try {
      console.log('🔄 [CLIENT] Updating calendar event...', {
        eventId,
        title: eventData.title,
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      dispatch({ type: 'SET_LOADING', payload: true });

      const response = await axios.put(`/api/calendar/events/${eventId}`, eventData);

      console.log('✅ [CLIENT] Event updated successfully', {
        eventId,
        title: response.data.event?.summary,
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      dispatch({ type: 'UPDATE_EVENT', payload: response.data.event });
      toast.success('Event updated successfully!');

      // Refresh events to ensure we have the latest data
      setTimeout(() => fetchEvents(), 1000);

      return response.data.event;
    } catch (error) {
      console.error('❌ [CLIENT] Error updating event:', {
        status: error.response?.status,
        message: error.response?.data?.error || error.message,
        eventId,
        sessionId: state.sessionId.substring(0, 8) + '...',
        url: error.config?.url
      });

      if (error.response?.status === 401) {
        dispatch({ type: 'CLEAR_SESSION' });
        clearSessionFromStorage();
        toast.error('Please reconnect your Google Calendar');
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to update event' });
        // Don't show technical errors to user, just log them
        console.error('Failed to update event:', error.message);
      }
      throw error;
    }
  };

  // Delete event
  const deleteEvent = async (eventId) => {
    if (!state.sessionId) {
      console.log('❌ [CLIENT] Cannot delete event: No session ID');
      toast.error('Please connect your Google Calendar first');
      throw new Error('Not authenticated');
    }

    try {
      console.log('🔄 [CLIENT] Deleting calendar event...', {
        eventId,
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      dispatch({ type: 'SET_LOADING', payload: true });

      const response = await axios.delete(`/api/calendar/events/${eventId}?confirmed=true`);

      console.log('✅ [CLIENT] Event deleted successfully', {
        eventId,
        sessionId: state.sessionId.substring(0, 8) + '...',
        message: response.data.message
      });

      dispatch({ type: 'DELETE_EVENT', payload: eventId });
      toast.success(response.data.message || 'Event deleted successfully!');

      // Refresh events to ensure we have the latest data
      setTimeout(() => fetchEvents(), 1000);
    } catch (error) {
      console.error('❌ [CLIENT] Error deleting event:', {
        status: error.response?.status,
        message: error.response?.data?.error || error.message,
        eventId,
        sessionId: state.sessionId.substring(0, 8) + '...',
        url: error.config?.url
      });

      if (error.response?.status === 401) {
        dispatch({ type: 'CLEAR_SESSION' });
        clearSessionFromStorage();
        toast.error('Please reconnect your Google Calendar');
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to delete event' });
        // Don't show technical errors to user, just log them
        console.error('Failed to delete event:', error.message);
      }
      throw error;
    }
  };

  // Clear AI suggestions
  const clearAISuggestions = () => {
    dispatch({ type: 'CLEAR_AI_SUGGESTIONS' });
  };

  // Confirm AI tools (for destructive tools like update/delete)
  const confirmAIAction = async (actions, actionResults) => {
    if (!state.sessionId) {
      console.log('❌ [CLIENT] Cannot confirm AI tools: No session ID');
      toast.error('Please connect your Google Calendar first');
      throw new Error('Not authenticated');
    }

    try {
      console.log('🔄 [CLIENT] Confirming AI tools...', {
        actions,
        actionResults,
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      dispatch({ type: 'SET_LOADING', payload: true });

      const results = [];

      // Execute each tool that requires confirmation
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const actionResult = actionResults[i];

        if (actionResult.requiresConfirmation) {
          let result;

          if (action === 'update_event') {
            const response = await axios.put(`/api/calendar/events/${actionResult.parameters.eventId}`, actionResult.parameters.event);
            result = response.data.event;
            dispatch({ type: 'UPDATE_EVENT', payload: result });
            toast.success('Event updated successfully!');
          } else if (action === 'delete_event') {
            // Get eventId from either parameters or the action result
            const eventId = actionResult.parameters?.eventId || actionResult.eventId;
            const response = await axios.delete(`/api/calendar/events/${eventId}?confirmed=true`);
            dispatch({ type: 'DELETE_EVENT', payload: eventId });
            toast.success(response.data.message || 'Event deleted successfully!');
            result = { deleted: true };
          } else {
            throw new Error(`Unknown action: ${action}`);
          }

          results.push({
            action,
            success: true,
            result
          });
        }
      }

      // Refresh events after all confirmed actions are executed
      // Make this silent - don't let fetchEvents failure affect AI response
      setTimeout(async () => {
        try {
          await fetchEvents(undefined, undefined, false); // silent refresh
        } catch (error) {
          // Silently handle fetchEvents errors - don't let them affect AI response
          console.log('⚠️ [CLIENT] Silent fetchEvents failed after AI operations:', error.message);
        }
      }, 2000);

      console.log('✅ [CLIENT] AI actions confirmed and executed:', {
        actions,
        results
      });

      return {
        success: true,
        results
      };
    } catch (error) {
      console.error('❌ [CLIENT] Error confirming AI actions:', {
        actions,
        error: error.message,
        status: error.response?.status
      });

      if (error.response?.status === 401) {
        dispatch({ type: 'CLEAR_SESSION' });
        clearSessionFromStorage();
        toast.error('Please reconnect your Google Calendar');
      } else {
        toast.error(`Failed to confirm actions: ${error.message}`);
      }
      throw error;
    }
  };

  // Get events for a specific date
  const getEventsForDate = (date) => {
    return state.events.filter(event => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  // Fetch user information from Google Calendar
  const fetchUserInfo = async () => {
    if (!state.sessionId) {
      console.log('❌ [CLIENT] Cannot fetch user info: No session ID');
      return;
    }

    try {
      console.log('🔄 [CLIENT] Fetching user information...', {
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      const response = await axios.get('/api/auth/user');

      console.log('✅ [CLIENT] User information received:', {
        name: response.data.name,
        email: response.data.email.substring(0, 20) + '...',
        timezone: response.data.timezone,
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      dispatch({ type: 'SET_USER', payload: response.data });
      return response.data;
    } catch (error) {
      console.error('❌ [CLIENT] Error fetching user information:', {
        status: error.response?.status,
        message: error.response?.data?.error || error.message,
        sessionId: state.sessionId.substring(0, 8) + '...'
      });

      // Don't clear session on user info fetch failure - it's not critical
      // Only log the error and continue
      console.log('⚠️ [CLIENT] User info fetch failed, but session remains valid');
      return null;
    }
  };

  // Check if date has events
  const hasEventsOnDate = (date) => {
    return getEventsForDate(date).length > 0;
  };

  const value = {
    ...state,
    fetchEvents,
    connectGoogleCalendar,
    disconnectGoogleCalendar,
    handleOAuthCallback,
    createEvent,
    updateEvent,
    deleteEvent,
    getAISuggestions,
    clearAISuggestions,
    confirmAIAction,
    getEventsForDate,
    hasEventsOnDate,
    fetchUserInfo,
    setCurrentDate: (date) => dispatch({ type: 'SET_CURRENT_DATE', payload: date }),
    setSelectedDate: (date) => dispatch({ type: 'SET_SELECTED_DATE', payload: date }),
  };

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
}; 