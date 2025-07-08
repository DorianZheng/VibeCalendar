import React, { useState } from 'react';
import { Brain, Calendar, Clock, MapPin, Users, CheckCircle, Sparkles } from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';
import { format } from 'date-fns';

const AIScheduler = () => {
  const { getAISuggestions, createEvent, aiSuggestions, loading } = useCalendar();
  
  const [formData, setFormData] = useState({
    description: '',
    preferences: '',
    duration: '60',
    priority: 'medium',
    attendees: '',
    location: ''
  });

  const [suggestion, setSuggestion] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsGenerating(true);

    try {
      const fullDescription = `
Event: ${formData.description}
Duration: ${formData.duration} minutes
Priority: ${formData.priority}
${formData.attendees ? `Attendees: ${formData.attendees}` : ''}
${formData.location ? `Location: ${formData.location}` : ''}
Preferences: ${formData.preferences}
      `.trim();

      const result = await getAISuggestions(fullDescription, formData.preferences);
      setSuggestion(result);
    } catch (error) {
      console.error('Error getting AI suggestion:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateEvent = async (suggestionData) => {
    try {
      const eventData = {
        title: suggestionData.title,
        description: suggestionData.description,
        startTime: suggestionData.suggestedTime,
        endTime: new Date(new Date(suggestionData.suggestedTime).getTime() + 
          parseInt(suggestionData.duration.split(':')[0]) * 60 * 60 * 1000 + 
          parseInt(suggestionData.duration.split(':')[1]) * 60 * 1000).toISOString(),
        location: suggestionData.location,
        attendees: suggestionData.attendees
      };

      await createEvent(eventData);
      setSuggestion(null);
      setFormData({
        description: '',
        preferences: '',
        duration: '60',
        priority: 'medium',
        attendees: '',
        location: ''
      });
    } catch (error) {
      console.error('Error creating event:', error);
    }
  };

  const examplePrompts = [
    "Team meeting to discuss Q4 strategy",
    "Client presentation for the new product launch",
    "Coffee catch-up with Sarah from marketing",
    "Weekly standup with the development team",
    "Doctor appointment for annual checkup"
  ];

  const SuggestionCard = ({ suggestion }) => (
    <div className="ai-suggestion animate-fade-in">
      <div className="flex items-center space-x-2 mb-4">
        <Sparkles className="h-5 w-5 text-purple-600" />
        <h3 className="font-semibold text-purple-900">AI Suggestion</h3>
      </div>
      
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-gray-900 mb-2">{suggestion.title}</h4>
          <p className="text-sm text-gray-600">{suggestion.description}</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              {format(new Date(suggestion.suggestedTime), 'EEEE, MMMM d, yyyy')}
            </span>
          </div>
          
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              {format(new Date(suggestion.suggestedTime), 'h:mm a')} ({suggestion.duration})
            </span>
          </div>
          
          {suggestion.location && (
            <div className="flex items-center space-x-2">
              <MapPin className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-600">{suggestion.location}</span>
            </div>
          )}
          
          {suggestion.attendees && suggestion.attendees.length > 0 && (
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {suggestion.attendees.length} attendee{suggestion.attendees.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">
            <strong>Reasoning:</strong> {suggestion.reasoning}
          </p>
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={() => handleCreateEvent(suggestion)}
            className="btn-primary flex items-center space-x-2"
          >
            <CheckCircle className="h-4 w-4" />
            <span>Create Event</span>
          </button>
          
          <button
            onClick={() => setSuggestion(null)}
            className="btn-secondary"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
                <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-lg">
              <Brain className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">AI Scheduler</h1>
              <p className="text-gray-600">Describe your event and let Google Gemini AI find the perfect time</p>
            </div>
          </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Form */}
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Event Details</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Event Description *
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Describe your event in natural language..."
                  className="input-field h-24 resize-none"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Duration (minutes)
                  </label>
                  <select
                    name="duration"
                    value={formData.duration}
                    onChange={handleInputChange}
                    className="input-field"
                  >
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="90">1.5 hours</option>
                    <option value="120">2 hours</option>
                    <option value="180">3 hours</option>
                    <option value="240">4 hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    name="priority"
                    value={formData.priority}
                    onChange={handleInputChange}
                    className="input-field"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Attendees (comma-separated emails)
                </label>
                <input
                  type="text"
                  name="attendees"
                  value={formData.attendees}
                  onChange={handleInputChange}
                  placeholder="john@example.com, jane@example.com"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location
                </label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  placeholder="Conference Room A, Zoom, etc."
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferences & Constraints
                </label>
                <textarea
                  name="preferences"
                  value={formData.preferences}
                  onChange={handleInputChange}
                  placeholder="I prefer morning meetings, avoid Mondays, need 15 min buffer..."
                  className="input-field h-20 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isGenerating || loading}
                className="btn-primary w-full flex items-center justify-center space-x-2"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Generating suggestion...</span>
                  </>
                ) : (
                  <>
                    <Brain className="h-4 w-4" />
                    <span>Get AI Suggestion</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Example Prompts */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-3">Example Prompts</h3>
            <div className="space-y-2">
              {examplePrompts.map((prompt, index) => (
                <button
                  key={index}
                  onClick={() => setFormData(prev => ({ ...prev, description: prompt }))}
                  className="block w-full text-left p-3 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  "{prompt}"
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* AI Suggestion */}
        <div className="space-y-6">
          {suggestion ? (
            <SuggestionCard suggestion={suggestion} />
          ) : (
            <div className="card bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200">
              <div className="text-center py-12">
                <Brain className="h-16 w-16 text-purple-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-purple-900 mb-2">
                  Ready to Schedule
                </h3>
                <p className="text-purple-700">
                  Fill out the form and let Google Gemini AI find the perfect time for your event.
                </p>
              </div>
            </div>
          )}

          {/* AI Features */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">AI Features</h3>
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                                 <div>
                   <p className="font-medium text-gray-900">Smart Time Selection</p>
                   <p className="text-sm text-gray-600">Google Gemini AI analyzes your calendar and suggests optimal times</p>
                 </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900">Conflict Avoidance</p>
                  <p className="text-sm text-gray-600">Automatically avoids scheduling conflicts</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900">Natural Language</p>
                  <p className="text-sm text-gray-600">Describe events in plain English</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                                 <div>
                   <p className="font-medium text-gray-900">Intelligent Reasoning</p>
                   <p className="text-sm text-gray-600">Get explanations from Google Gemini AI for why times were chosen</p>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIScheduler; 