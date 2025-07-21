import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Users
} from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isToday,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek
} from 'date-fns';

const Calendar = () => {
  const { 
    events, 
    currentDate, 
    selectedDate,
    fetchEvents, 
    getEventsForDate,
    hasEventsOnDate,
    setCurrentDate,
    setSelectedDate,
    sessionId,
    sessionValidated
  } = useCalendar();

  const [viewMode, setViewMode] = useState('month');
  const [lastFetchDate, setLastFetchDate] = useState(null);

  // Debounced fetch events to prevent excessive API calls
  const debouncedFetchEvents = useCallback(async () => {
    const now = new Date();
    const lastFetch = lastFetchDate;
    
    // Only fetch if we haven't fetched in the last 30 seconds
    if (!lastFetch || (now - lastFetch) > 30000) {
      setLastFetchDate(now);
      await fetchEvents();
    }
  }, [fetchEvents, lastFetchDate]);

  useEffect(() => {
    // Only fetch if we have events and the month has changed significantly
    if (events.length > 0 && sessionId && sessionValidated) {
      debouncedFetchEvents();
    }
  }, [debouncedFetchEvents, events.length, sessionId, sessionValidated]);

  // Initial fetch when component mounts
  useEffect(() => {
    if (events.length === 0 && sessionId && sessionValidated) {
      fetchEvents();
    }
  }, [events.length, sessionId, sessionValidated]); // Only run when session is ready

  const goToPreviousMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const getCalendarDays = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  };

  const getEventsForDay = (day) => {
    return getEventsForDate(day);
  };

  const getEventTime = (event) => {
    if (event.start.dateTime) {
      return format(new Date(event.start.dateTime), 'h:mm a');
    }
    return 'All day';
  };

  const DayCell = ({ day, events }) => {
    const isCurrentMonth = isSameMonth(day, currentDate);
    const isSelected = isSameDay(day, selectedDate);
    const isTodayDate = isToday(day);
    const dayEvents = events || getEventsForDay(day);

    return (
      <div
        className={`
          calendar-day p-2 relative
          ${!isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'}
          ${isTodayDate ? 'today' : ''}
          ${isSelected ? 'ring-2 ring-primary-500' : ''}
          ${dayEvents.length > 0 ? 'has-events' : ''}
        `}
        onClick={() => setSelectedDate(day)}
      >
        <div className="flex items-center justify-between mb-1">
          <span className={`
            text-sm font-medium
            ${isTodayDate ? 'text-primary-600' : ''}
            ${isSelected ? 'text-primary-700' : ''}
          `}>
            {format(day, 'd')}
          </span>
          {dayEvents.length > 0 && (
            <span className="w-2 h-2 bg-primary-500 rounded-full"></span>
          )}
        </div>

        <div className="space-y-1">
          {dayEvents.slice(0, 2).map((event) => (
            <div
              key={event.id}
              className="text-xs p-1 bg-primary-100 text-primary-800 rounded truncate"
              title={event.summary}
            >
              {event.summary}
            </div>
          ))}
          {dayEvents.length > 2 && (
            <div className="text-xs text-gray-500">
              +{dayEvents.length - 2} more
            </div>
          )}
        </div>
      </div>
    );
  };

  const SelectedDayEvents = () => {
    const dayEvents = getEventsForDay(selectedDate);

    return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </h3>
          <Link to="/new-event" className="btn-primary flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Add Event</span>
          </Link>
        </div>

        {dayEvents.length > 0 ? (
          <div className="space-y-3">
            {dayEvents.map((event) => (
              <div key={event.id} className="event-card">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 mb-1">
                      {event.summary}
                    </h4>
                    <div className="space-y-1 text-sm text-gray-600">
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4" />
                        <span>{getEventTime(event)}</span>
                      </div>
                      {event.location && (
                        <div className="flex items-center space-x-2">
                          <MapPin className="h-4 w-4" />
                          <span>{event.location}</span>
                        </div>
                      )}
                      {event.attendees && event.attendees.length > 0 && (
                        <div className="flex items-center space-x-2">
                          <Users className="h-4 w-4" />
                          <span>{event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      {event.description && (
                        <p className="text-gray-600 mt-2">{event.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <CalendarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No events scheduled for this day</p>
            <Link to="/new-event" className="btn-primary">
              Schedule an Event
            </Link>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-600">View and manage your events</p>
        </div>
        <div className="flex items-center space-x-3">
                     <Link to="/ai-scheduler" className="btn-secondary flex items-center space-x-2">
             <CalendarIcon className="h-4 w-4" />
             <span>Gemini Schedule</span>
           </Link>
          <Link to="/new-event" className="btn-primary flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>New Event</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-3">
          <div className="card">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={goToPreviousMonth}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                
                <h2 className="text-xl font-semibold text-gray-900">
                  {format(currentDate, 'MMMM yyyy')}
                </h2>
                
                <button
                  onClick={goToNextMonth}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={goToToday}
                  className="btn-secondary text-sm"
                >
                  Today
                </button>
                
                <select
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value)}
                  className="input-field text-sm"
                >
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                  <option value="day">Day</option>
                </select>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
              {/* Day Headers */}
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="bg-gray-50 p-3 text-center">
                  <span className="text-sm font-medium text-gray-700">{day}</span>
                </div>
              ))}

              {/* Calendar Days */}
              {getCalendarDays().map((day) => (
                <DayCell key={day.toISOString()} day={day} />
              ))}
            </div>
          </div>
        </div>

        {/* Selected Day Events */}
        <div className="lg:col-span-1">
          <SelectedDayEvents />
        </div>
      </div>
    </div>
  );
};

export default Calendar; 