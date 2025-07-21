import React from 'react';
import { Calendar, User, Settings, LogOut } from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';

const Header = ({ user }) => {
  const { isGoogleConnected, connectGoogleCalendar } = useCalendar();

  return (
    <header className="bg-white px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 text-gray-600" />
            <h1 className="text-sm font-normal text-gray-800 m-0 leading-none">Vibe Calendar made by Dorian and his intern Cursor</h1>
          </div>
          
          <div className="hidden md:flex items-center text-xs text-gray-500">
            <span>AI-powered scheduling</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Google Calendar Connection Status */}
          <div className="flex items-center space-x-1">
            {isGoogleConnected ? (
              <div className="flex items-center space-x-1 text-gray-600">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
                <span className="text-xs font-normal">Connected</span>
              </div>
            ) : (
              <button
                onClick={connectGoogleCalendar}
                className="flex items-center space-x-1 text-xs text-gray-600 hover:text-gray-700 transition-colors"
              >
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
                <span>Connect Google Calendar</span>
              </button>
            )}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                <User className="h-3 w-3 text-gray-600" />
              </div>
              <div className="hidden md:block">
                <p className="text-xs font-normal text-gray-800 m-0">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-500 m-0">
                  {user?.email || 'user@example.com'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-1">
              <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <Settings className="h-3 w-3" />
              </button>
              <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <LogOut className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header; 