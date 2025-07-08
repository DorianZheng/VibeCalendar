import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  Clock, 
  Users, 
  Plus, 
  Brain, 
  TrendingUp,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';
import { format, isToday, isTomorrow, startOfWeek, endOfWeek } from 'date-fns';

const Dashboard = () => {
  const { 
    events, 
    currentDate, 
    fetchEvents, 
    getEventsForDate,
    hasEventsOnDate 
  } = useCalendar();
  
  const [stats, setStats] = useState({
    totalEvents: 0,
    thisWeek: 0,
    today: 0,
    upcoming: 0
  });

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    const today = new Date();
    const weekStart = startOfWeek(today);
    const weekEnd = endOfWeek(today);
    
    const todayEvents = getEventsForDate(today);
    const weekEvents = events.filter(event => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      return eventDate >= weekStart && eventDate <= weekEnd;
    });
    
    const upcomingEvents = events.filter(event => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      return eventDate > today;
    });

    setStats({
      totalEvents: events.length,
      thisWeek: weekEvents.length,
      today: todayEvents.length,
      upcoming: upcomingEvents.length
    });
  }, [events, currentDate]);

  const getUpcomingEvents = () => {
    const today = new Date();
    return events
      .filter(event => {
        const eventDate = new Date(event.start.dateTime || event.start.date);
        return eventDate >= today;
      })
      .sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date))
      .slice(0, 5);
  };

  const getEventTime = (event) => {
    if (event.start.dateTime) {
      return format(new Date(event.start.dateTime), 'h:mm a');
    }
    return 'All day';
  };

  const getEventDate = (event) => {
    const eventDate = new Date(event.start.dateTime || event.start.date);
    if (isToday(eventDate)) return 'Today';
    if (isTomorrow(eventDate)) return 'Tomorrow';
    return format(eventDate, 'MMM d');
  };

  const StatCard = ({ title, value, icon: Icon, color, trend }) => (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {trend && (
            <p className={`text-sm ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '+' : ''}{trend} from last week
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );

  const QuickActionCard = ({ title, description, icon: Icon, href, color }) => (
    <Link to={href} className="card hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center space-x-4">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Welcome back! Here's what's happening with your calendar.</p>
        </div>
        <div className="flex space-x-3">
          <Link to="/new-event" className="btn-primary flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>New Event</span>
          </Link>
                     <Link to="/ai-scheduler" className="btn-secondary flex items-center space-x-2">
             <Brain className="h-4 w-4" />
             <span>Gemini Schedule</span>
           </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Events"
          value={stats.totalEvents}
          icon={Calendar}
          color="bg-blue-500"
        />
        <StatCard
          title="This Week"
          value={stats.thisWeek}
          icon={Clock}
          color="bg-green-500"
        />
        <StatCard
          title="Today"
          value={stats.today}
          icon={CheckCircle}
          color="bg-purple-500"
        />
        <StatCard
          title="Upcoming"
          value={stats.upcoming}
          icon={TrendingUp}
          color="bg-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Events */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Upcoming Events</h2>
              <Link to="/calendar" className="text-sm text-primary-600 hover:text-primary-700">
                View all
              </Link>
            </div>
            
            {getUpcomingEvents().length > 0 ? (
              <div className="space-y-4">
                {getUpcomingEvents().map((event) => (
                  <div key={event.id} className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                        <Calendar className="h-5 w-5 text-primary-600" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {event.summary}
                      </p>
                      <p className="text-sm text-gray-500">
                        {getEventDate(event)} • {getEventTime(event)}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                        {event.location ? 'In-person' : 'Virtual'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No upcoming events</p>
                <Link to="/new-event" className="text-primary-600 hover:text-primary-700 text-sm">
                  Create your first event
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <QuickActionCard
                title="New Event"
                description="Create a new calendar event"
                icon={Plus}
                href="/new-event"
                color="bg-blue-500"
              />
                             <QuickActionCard
                 title="Gemini Scheduler"
                 description="Let Google Gemini AI find the best time"
                 icon={Brain}
                 href="/ai-scheduler"
                 color="bg-purple-500"
               />
              <QuickActionCard
                title="View Calendar"
                description="See your full calendar"
                icon={Calendar}
                href="/calendar"
                color="bg-green-500"
              />
            </div>
          </div>

          {/* AI Tips */}
          <div className="card bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
            <div className="flex items-center space-x-3 mb-3">
              <Brain className="h-6 w-6 text-purple-600" />
              <h3 className="font-semibold text-purple-900">Google Gemini AI Tips</h3>
            </div>
            <ul className="space-y-2 text-sm text-purple-800">
              <li className="flex items-start space-x-2">
                <CheckCircle className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <span>Use natural language to describe your events</span>
              </li>
                               <li className="flex items-start space-x-2">
                   <CheckCircle className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                   <span>Google Gemini AI will suggest optimal times based on your schedule</span>
                 </li>
                               <li className="flex items-start space-x-2">
                   <CheckCircle className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                   <span>Get intelligent reminders and follow-ups powered by Gemini</span>
                 </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard; 