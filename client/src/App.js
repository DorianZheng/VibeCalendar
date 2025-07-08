import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';

// Components
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Calendar from './components/Calendar';
import AIScheduler from './components/AIScheduler';
import EventForm from './components/EventForm';
import Dashboard from './components/Dashboard';

// Context
import { CalendarProvider } from './context/CalendarContext';

// API configuration
axios.defaults.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    <CalendarProvider>
      <Router>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} />
          
          <div className="flex">
            <Sidebar />
            
            <main className="flex-1 p-6">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/ai-scheduler" element={<AIScheduler />} />
                <Route path="/new-event" element={<EventForm />} />
              </Routes>
            </main>
          </div>
        </div>
      </Router>
    </CalendarProvider>
  );
}

export default App; 