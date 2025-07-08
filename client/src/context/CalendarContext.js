import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const CalendarContext = createContext();

const initialState = {
  events: [],
  currentDate: new Date(),
  selectedDate: new Date(),
  loading: false,
  error: null,
  isGoogleConnected: false,
  aiSuggestions: [],
};

const calendarReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    
    case 'SET_EVENTS':
      return { ...state, events: action.payload, loading: false };
    
    case 'ADD_EVENT':
      return { 
        ...state, 
        events: [...state.events, action.payload],
        loading: false 
      };
    
    case 'UPDATE_EVENT':
      return {
        ...state,
        events: state.events.map(event => 
          event.id === action.payload.id ? action.payload : event
        ),
        loading: false
      };
    
    case 'DELETE_EVENT':
      return {
        ...state,
        events: state.events.filter(event => event.id !== action.payload),
        loading: false
      };
    
    case 'SET_CURRENT_DATE':
      return { ...state, currentDate: action.payload };
    
    case 'SET_SELECTED_DATE':
      return { ...state, selectedDate: action.payload };
    
    case 'SET_GOOGLE_CONNECTED':
      return { ...state, isGoogleConnected: action.payload };
    
    case 'SET_AI_SUGGESTIONS':
      return { ...state, aiSuggestions: action.payload };
    
    case 'CLEAR_AI_SUGGESTIONS':
      return { ...state, aiSuggestions: [] };
    
    default:
      return state;
  }
};

export const CalendarProvider = ({ children }) => {
  const [state, dispatch] = useReducer(calendarReducer, initialState);

  // Fetch events from Google Calendar
  const fetchEvents = async (startDate, endDate) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const timeMin = startDate ? startDate.toISOString() : new Date().toISOString();
      const timeMax = endDate ? endDate.toISOString() : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const response = await axios.get('/api/calendar/events', {
        params: { timeMin, timeMax }
      });
      
      dispatch({ type: 'SET_EVENTS', payload: response.data.items || [] });
    } catch (error) {
      console.error('Error fetching events:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to fetch events' });
      toast.error('Failed to fetch calendar events');
    }
  };

  // Connect to Google Calendar
  const connectGoogleCalendar = async () => {
    try {
      const response = await axios.get('/api/auth/google');
      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error('Error connecting to Google Calendar:', error);
      toast.error('Failed to connect to Google Calendar');
    }
  };

  // Create new event
  const createEvent = async (eventData) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const response = await axios.post('/api/calendar/events', eventData);
      
      dispatch({ type: 'ADD_EVENT', payload: response.data.event });
      toast.success('Event created successfully!');
      
      return response.data.event;
    } catch (error) {
      console.error('Error creating event:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to create event' });
      toast.error('Failed to create event');
      throw error;
    }
  };

  // Get AI scheduling suggestions
  const getAISuggestions = async (description, preferences, existingEvents) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const response = await axios.post('/api/ai/schedule', {
        description,
        preferences,
        existingEvents: existingEvents || state.events
      });
      
      dispatch({ type: 'SET_AI_SUGGESTIONS', payload: [response.data.suggestion] });
      return response.data.suggestion;
    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to get AI suggestions' });
      toast.error('Failed to get AI scheduling suggestions');
      throw error;
    }
  };

  // Smart scheduling with AI
  const smartSchedule = async (description, preferences, constraints) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const response = await axios.post('/api/ai/smart-schedule', {
        description,
        preferences,
        constraints
      });
      
      return response.data;
    } catch (error) {
      console.error('Error with smart scheduling:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to perform smart scheduling' });
      toast.error('Failed to perform smart scheduling');
      throw error;
    }
  };

  // Update event
  const updateEvent = async (eventId, eventData) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const response = await axios.put(`/api/calendar/events/${eventId}`, eventData);
      
      dispatch({ type: 'UPDATE_EVENT', payload: response.data.event });
      toast.success('Event updated successfully!');
      
      return response.data.event;
    } catch (error) {
      console.error('Error updating event:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to update event' });
      toast.error('Failed to update event');
      throw error;
    }
  };

  // Delete event
  const deleteEvent = async (eventId) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      await axios.delete(`/api/calendar/events/${eventId}`);
      
      dispatch({ type: 'DELETE_EVENT', payload: eventId });
      toast.success('Event deleted successfully!');
    } catch (error) {
      console.error('Error deleting event:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to delete event' });
      toast.error('Failed to delete event');
      throw error;
    }
  };

  // Clear AI suggestions
  const clearAISuggestions = () => {
    dispatch({ type: 'CLEAR_AI_SUGGESTIONS' });
  };

  // Get events for a specific date
  const getEventsForDate = (date) => {
    return state.events.filter(event => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      return eventDate.toDateString() === date.toDateString();
    });
  };

  // Check if date has events
  const hasEventsOnDate = (date) => {
    return getEventsForDate(date).length > 0;
  };

  const value = {
    ...state,
    fetchEvents,
    connectGoogleCalendar,
    createEvent,
    updateEvent,
    deleteEvent,
    getAISuggestions,
    smartSchedule,
    clearAISuggestions,
    getEventsForDate,
    hasEventsOnDate,
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