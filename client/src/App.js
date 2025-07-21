import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';

// Import API logger to initialize interceptors
import './utils/apiLogger';

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
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="max-w-sm w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-normal text-gray-800 mb-6">Vibe Calendar made by Dorian and his intern Cursor</h1>
        </div>
        
        <div className="space-y-4">
          <button 
            onClick={onConnect}
            className="w-full px-4 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-normal"
          >
            Continue
          </button>
          
          <div className="text-center">
            <span className="text-sm text-gray-600">Don't have an account? </span>
            <button className="text-sm text-blue-600 hover:text-blue-700 transition-colors">
              Sign up
            </button>
          </div>
          
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">OR</span>
            </div>
          </div>
          
          <button 
            onClick={onConnect}
            className="w-full px-4 py-3 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-3 text-sm font-normal"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>
        
        <div className="text-center mt-8 pt-6 border-t border-gray-200">
          <div className="flex justify-center space-x-4 text-xs text-gray-500">
            <button className="hover:text-gray-700 transition-colors">Terms of Use</button>
            <div className="w-px bg-gray-300"></div>
            <button className="hover:text-gray-700 transition-colors">Privacy Policy</button>
          </div>
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-3"></div>
          <p className="text-sm text-gray-600">Loading Vibe Calendar made by Dorian and his intern Cursor...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-sm w-full">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-normal text-gray-800 mb-6">Vibe Calendar made by Dorian and his intern Cursor</h1>
          </div>
          
          <div className="space-y-4">
            <button 
              onClick={() => setIsAuthenticated(true)}
              className="w-full px-4 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-normal"
            >
              Continue
            </button>
            
            <div className="text-center">
              <span className="text-sm text-gray-600">Don't have an account? </span>
              <button className="text-sm text-blue-600 hover:text-blue-700 transition-colors">
                Sign up
              </button>
            </div>
            
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">OR</span>
              </div>
            </div>
            
            <button 
              onClick={() => setIsAuthenticated(true)}
              className="w-full px-4 py-3 bg-white text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-3 text-sm font-normal"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
          
          <div className="text-center mt-8 pt-6 border-t border-gray-200">
            <div className="flex justify-center space-x-4 text-xs text-gray-500">
              <button className="hover:text-gray-700 transition-colors">Terms of Use</button>
              <div className="w-px bg-gray-300"></div>
              <button className="hover:text-gray-700 transition-colors">Privacy Policy</button>
            </div>
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
      <main>
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