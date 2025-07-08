import React from 'react';
import { Calendar, User, Settings, LogOut } from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';

const Header = ({ user }) => {
  const { isGoogleConnected, connectGoogleCalendar } = useCalendar();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Calendar className="h-8 w-8 text-primary-600" />
            <h1 className="text-2xl font-bold text-gradient">VibeCalendar</h1>
          </div>
          
          <div className="hidden md:flex items-center space-x-1 text-sm text-gray-500">
            <span>AI-powered scheduling</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Google Calendar Connection Status */}
          <div className="flex items-center space-x-2">
            {isGoogleConnected ? (
              <div className="flex items-center space-x-2 text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium">Connected</span>
              </div>
            ) : (
              <button
                onClick={connectGoogleCalendar}
                className="flex items-center space-x-2 text-sm text-gray-600 hover:text-primary-600 transition-colors"
              >
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <span>Connect Google Calendar</span>
              </button>
            )}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-primary-600" />
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-medium text-gray-900">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-500">
                  {user?.email || 'user@example.com'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
                <Settings className="h-5 w-5" />
              </button>
              <button className="p-2 text-gray-400 hover:text-red-600 transition-colors">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header; 