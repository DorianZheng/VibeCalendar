import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';

// Components
import Calendar from './components/Calendar';
import AIScheduler from './components/AIScheduler';
import EventForm from './components/EventForm';
import Dashboard from './components/Dashboard';

// Context
import { CalendarProvider, useCalendar } from './context/CalendarContext';

// Request notification permission on app load
const requestNotificationPermission = () => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        console.log('✅ Notification permission granted');
      } else {
        console.log('❌ Notification permission denied');
      }
    });
  }
};

// API configuration
axios.defaults.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:50001';

// Component to handle OAuth callback
const OAuthHandler = ({ onSessionReceived }) => {
  const location = useLocation();
  const processedSessionId = useRef(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const sessionId = urlParams.get('sessionId');
    
    if (sessionId && sessionId !== processedSessionId.current) {
      processedSessionId.current = sessionId;
      onSessionReceived(sessionId);
      // Clean up the URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [location, onSessionReceived]);

  return null;
};

// Simple Welcome Page Component
const WelcomePage = ({ onConnect }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gradient mb-4">VibeCalendar</h1>
          <p className="text-lg text-gray-600 mb-2">Your AI-powered calendar assistant</p>
          <p className="text-sm text-gray-500">Connect your Google Calendar to get started</p>
        </div>
        
        <div className="card">
          <div className="mb-6">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to VibeCalendar</h2>
            <p className="text-gray-600 text-sm">
              Connect your Google Calendar to start scheduling events with AI assistance
            </p>
          </div>
          
          <button 
            onClick={onConnect}
            className="w-full btn-primary flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <span>Connect Google Calendar</span>
          </button>
          
          <p className="text-xs text-gray-500 mt-4">
            We'll only access your calendar to help you schedule events
          </p>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  useEffect(() => {
    // Request notification permission on app load
    requestNotificationPermission();
    
    // Check if user is authenticated
    const checkAuth = async () => {
      try {
        const response = await axios.get('/api/health');
        if (response.status === 200) {
          // For now, we'll assume user is authenticated if server is running
          // In a real app, you'd check for valid tokens
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error('Server connection failed:', error);
        toast.error('Unable to connect to server');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const handleSessionReceived = (sessionId) => {
    setPendingSessionId(sessionId);
    setIsGoogleConnected(true);
  };

  const handleConnectGoogle = async () => {
    try {
      const response = await axios.get('/api/auth/google');
      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error('Error connecting to Google Calendar:', error);
      toast.error('Failed to connect to Google Calendar');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading VibeCalendar...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-purple-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-auto p-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gradient mb-2">VibeCalendar</h1>
            <p className="text-gray-600">AI-powered calendar scheduling</p>
          </div>
          
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Welcome!</h2>
            <p className="text-gray-600 mb-6">
              Connect your Google Calendar and let AI help you schedule events efficiently.
            </p>
            
            <button 
              onClick={() => setIsAuthenticated(true)}
              className="btn-primary w-full"
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <OAuthHandler onSessionReceived={handleSessionReceived} />
      <CalendarProvider>
        <AppContent user={user} pendingSessionId={pendingSessionId} />
      </CalendarProvider>
    </Router>
  );
}

// Separate component to use the calendar context
const AppContent = ({ user, pendingSessionId }) => {
  const { handleOAuthCallback, sessionId, isGoogleConnected } = useCalendar();

  useEffect(() => {
    if (pendingSessionId) {
      handleOAuthCallback(pendingSessionId);
    }
  }, [pendingSessionId, handleOAuthCallback]);

  // Show welcome page if not connected to Google Calendar
  if (!isGoogleConnected && !sessionId) {
    return <WelcomePage onConnect={async () => {
      try {
        const response = await axios.get('/api/auth/google');
        window.location.href = response.data.authUrl;
      } catch (error) {
        console.error('Error connecting to Google Calendar:', error);
        toast.error('Failed to connect to Google Calendar');
      }
    }} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/ai-scheduler" element={<AIScheduler />} />
          <Route path="/new-event" element={<EventForm />} />
        </Routes>
      </main>
    </div>
  );
};

export default App; 