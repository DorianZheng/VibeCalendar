import React, { useEffect, useState, useRef } from 'react';
import { 
  Calendar, 
  Clock, 
  Send,
  MessageCircle,
  Play,
  Pause,
  RotateCcw
} from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';
import { format, isToday, isTomorrow } from 'date-fns';

const Dashboard = () => {
  const { 
    events, 
    fetchEvents, 
    getAISuggestions,
    createEvent,
    loading,
    sessionId,
    isGoogleConnected,
    sessionValidated,
    user,
    fetchUserInfo,
    disconnectGoogleCalendar
  } = useCalendar();
  
  const [chatMessages, setChatMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);
  const chatContainerRef = useRef(null);
  
  // Pomodoro timer state
  const [pomodoroState, setPomodoroState] = useState('idle'); // idle, work, break
  const [timeLeft, setTimeLeft] = useState(25 * 60); // Default 25 minutes in seconds
  const [isRunning, setIsRunning] = useState(false);
  const [showPomodoroSuggestion, setShowPomodoroSuggestion] = useState(false);
  const [pomodoroSuggestion, setPomodoroSuggestion] = useState(null);
  const [workDuration, setWorkDuration] = useState(25); // AI-determined work duration in minutes
  const [breakDuration, setBreakDuration] = useState(5); // AI-determined break duration in minutes
  const [showPomodoroNotification, setShowPomodoroNotification] = useState(false);
  const [pomodoroNotificationData, setPomodoroNotificationData] = useState(null);
  const [notifiedEvents, setNotifiedEvents] = useState(new Set()); // Track events that have triggered notifications
  const [pomodoroSessionInitialized, setPomodoroSessionInitialized] = useState(false); // Track if system prompt was sent
  const pomodoroIntervalRef = useRef(null);

  // Language detection function
  const detectUserLanguage = () => {
    // Try to detect from browser language
    const browserLang = navigator.language || navigator.userLanguage;
    
    // Try to detect from user's input messages
    const userMessages = chatMessages.filter(msg => msg.type === 'user');
    if (userMessages.length > 0) {
      const lastMessage = userMessages[userMessages.length - 1].content;
      // Simple language detection based on common patterns
      if (/[\u4e00-\u9fff]/.test(lastMessage)) return 'zh'; // Chinese characters
      if (/[\u3040-\u309f\u30a0-\u30ff]/.test(lastMessage)) return 'ja'; // Japanese
      if (/[\uac00-\ud7af]/.test(lastMessage)) return 'ko'; // Korean
      if (/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(lastMessage)) return 'es'; // Spanish
      if (/[àâäéèêëïîôöùûüÿç]/.test(lastMessage)) return 'fr'; // French
      if (/[äöüß]/.test(lastMessage)) return 'de'; // German
    }
    
    // Fallback to browser language
    if (browserLang.startsWith('zh')) return 'zh';
    if (browserLang.startsWith('ja')) return 'ja';
    if (browserLang.startsWith('ko')) return 'ko';
    if (browserLang.startsWith('es')) return 'es';
    if (browserLang.startsWith('fr')) return 'fr';
    if (browserLang.startsWith('de')) return 'de';
    
    return 'en'; // Default to English
  };

  // Multilingual Pomodoro notification texts
  const getPomodoroTexts = (lang) => {
    const texts = {
      en: {
        title: 'Pomodoro Time!',
        startButton: 'Start Pomodoro',
        notNowButton: 'Not Now',
        autoClose: 'This will auto-close in 30 seconds',
        sessionPlan: 'Session Plan:',
        focus: 'Focus:',
        preparation: 'Preparation:'
      },
      zh: {
        title: '番茄钟时间！',
        startButton: '开始番茄钟',
        notNowButton: '稍后再说',
        autoClose: '30秒后自动关闭',
        sessionPlan: '会话计划：',
        focus: '专注：',
        preparation: '准备：'
      },
      ja: {
        title: 'ポモドーロ時間！',
        startButton: 'ポモドーロ開始',
        notNowButton: '後で',
        autoClose: '30秒で自動閉じます',
        sessionPlan: 'セッション計画：',
        focus: 'フォーカス：',
        preparation: '準備：'
      },
      ko: {
        title: '뽀모도로 시간!',
        startButton: '뽀모도로 시작',
        notNowButton: '나중에',
        autoClose: '30초 후 자동으로 닫힙니다',
        sessionPlan: '세션 계획:',
        focus: '집중:',
        preparation: '준비:'
      },
      es: {
        title: '¡Hora de Pomodoro!',
        startButton: 'Iniciar Pomodoro',
        notNowButton: 'Ahora No',
        autoClose: 'Se cerrará automáticamente en 30 segundos',
        sessionPlan: 'Plan de Sesión:',
        focus: 'Enfoque:',
        preparation: 'Preparación:'
      },
      fr: {
        title: 'Temps de Pomodoro !',
        startButton: 'Démarrer Pomodoro',
        notNowButton: 'Plus Tard',
        autoClose: 'Se fermera automatiquement dans 30 secondes',
        sessionPlan: 'Plan de Session :',
        focus: 'Focus :',
        preparation: 'Préparation :'
      },
      de: {
        title: 'Pomodoro-Zeit!',
        startButton: 'Pomodoro starten',
        notNowButton: 'Später',
        autoClose: 'Wird in 30 Sekunden automatisch geschlossen',
        sessionPlan: 'Sitzungsplan:',
        focus: 'Fokus:',
        preparation: 'Vorbereitung:'
      }
    };
    
    return texts[lang] || texts.en;
  };

  // Debug function to check localStorage
  const debugLocalStorage = () => {
    const sessionId = localStorage.getItem('vibeCalendar_sessionId');
    const connectedAt = localStorage.getItem('vibeCalendar_connectedAt');
    console.log('🔍 [DEBUG] localStorage contents:', {
      sessionId: sessionId ? sessionId.substring(0, 8) + '...' : 'none',
      connectedAt: connectedAt || 'none'
    });
  };

  useEffect(() => {
    // Only fetch events if we have a validated session and haven't attempted yet
    if (sessionId && isGoogleConnected && sessionValidated && !hasAttemptedFetch) {
      console.log('🔄 [DASHBOARD] Session validated, fetching events with session ID:', sessionId.substring(0, 8) + '...');
      setHasAttemptedFetch(true);
      // Add a small delay to ensure axios headers are properly set
      setTimeout(() => {
        fetchEvents();
      }, 200);
    } else if (!sessionId) {
      console.log('🔄 [DASHBOARD] No session ID, skipping event fetch');
    } else if (sessionId && !sessionValidated) {
      console.log('🔄 [DASHBOARD] Session ID exists but not validated, waiting...');
    } else if (sessionId && !isGoogleConnected) {
      console.log('🔄 [DASHBOARD] Session ID exists but not connected, waiting for validation...');
    }
  }, [sessionId, isGoogleConnected, sessionValidated, hasAttemptedFetch]); // Removed fetchEvents from dependencies to prevent infinite loop

  // Debug: Log events when they change
  useEffect(() => {
    console.log('Events updated:', events);
  }, [events]);

  // Debug: Check localStorage on mount
  useEffect(() => {
    debugLocalStorage();
  }, []);
  
  // Reset Pomodoro session when Google Calendar connection changes
  useEffect(() => {
    if (sessionId) {
      setPomodoroSessionInitialized(false);
      console.log('🔄 [CLIENT] Reset Pomodoro session due to new Google Calendar connection');
    }
  }, [sessionId]);

  // Request notification permissions on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Pomodoro browser notification function (for timer completion)
  const showPomodoroBrowserNotification = (title, message) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'pomodoro-notification',
        requireInteraction: false,
        silent: false
      });
    } else {
      console.log('Notification permission not granted');
    }
  };

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages, isTyping]);

  // Fetch user information when session is validated (optional)
  useEffect(() => {
    if (sessionId && isGoogleConnected && sessionValidated && !user) {
      console.log('🔄 [DASHBOARD] Session validated, fetching user information');
      // Add a delay to ensure session is fully established
      setTimeout(() => {
        fetchUserInfo().catch(error => {
          console.log('⚠️ [DASHBOARD] Failed to fetch user info (non-critical):', error.message);
        });
      }, 1000); // Increased delay to ensure session is stable
    }
  }, [sessionId, isGoogleConnected, sessionValidated, user, fetchUserInfo]);

  const getUpcomingEvents = () => {
    const today = new Date();
    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(today.getDate() + 3);
    
    const upcoming = events
      .filter(event => {
        const eventDate = new Date(event.start.dateTime || event.start.date);
        return eventDate >= today && eventDate <= threeDaysFromNow;
      })
      .sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));
    
    console.log('Upcoming events (next 3 days):', upcoming);
    return upcoming;
  };

  const getEventsByDay = () => {
    const events = getUpcomingEvents();
    const eventsByDay = {};
    
    // Initialize next 3 days
    for (let i = 0; i < 3; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dateKey = date.toDateString();
      eventsByDay[dateKey] = [];
    }
    
    // Group events by day
    events.forEach(event => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      const dateKey = eventDate.toDateString();
      if (eventsByDay[dateKey]) {
        eventsByDay[dateKey].push(event);
      }
    });
    
    return eventsByDay;
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

  // Pomodoro timer functions
  const startPomodoro = () => {
    setPomodoroState('work');
    setTimeLeft(workDuration * 60); // Use AI-determined work duration
    setIsRunning(true);
    setShowPomodoroSuggestion(false);
    setPomodoroSuggestion(null);
  };

  const pausePomodoro = () => {
    setIsRunning(false);
  };

  const resumePomodoro = () => {
    setIsRunning(true);
  };

  const resetPomodoro = () => {
    setPomodoroState('idle');
    setTimeLeft(workDuration * 60); // Use AI-determined work duration
    setIsRunning(false);
    setShowPomodoroSuggestion(false);
    setPomodoroSuggestion(null);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Check for upcoming events within 5 minutes and get AI suggestion
  const checkUpcomingEvents = async () => {
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    
    const upcomingSoon = events.filter(event => {
      const eventTime = new Date(event.start.dateTime || event.start.date);
      return eventTime >= now && eventTime <= fiveMinutesFromNow;
    });

    // Filter out events that have already triggered notifications
    const newEvents = upcomingSoon.filter(event => {
      const eventId = event.id || `${event.summary}_${event.start.dateTime || event.start.date}`;
      return !notifiedEvents.has(eventId);
    });

    console.log('🔍 [CLIENT] Checking upcoming events:', {
      totalEvents: events.length,
      upcomingSoonCount: upcomingSoon.length,
      newEventsCount: newEvents.length,
      notifiedEventsCount: notifiedEvents.size,
      pomodoroState: pomodoroState,
      showPomodoroSuggestion: showPomodoroSuggestion,
      timestamp: new Date().toISOString()
    });

    if (newEvents.length > 0 && pomodoroState === 'idle' && !showPomodoroNotification && !isRunning) {
      console.log('🍅 [CLIENT] Triggering Pomodoro suggestion for events:', {
        events: newEvents.map(event => ({
          title: event.summary,
          time: new Date(event.start.dateTime || event.start.date).toLocaleTimeString(),
          timeUntil: Math.round((new Date(event.start.dateTime || event.start.date) - now) / (1000 * 60))
        }))
      });
      
      // Mark these events as notified
      const newEventIds = newEvents.map(event => event.id || `${event.summary}_${event.start.dateTime || event.start.date}`);
      setNotifiedEvents(prev => new Set([...prev, ...newEventIds]));
      
      // Get AI suggestion for Pomodoro sessions
      try {
        const suggestion = await getPomodoroSuggestion(newEvents);
        
        console.log('✅ [CLIENT] Pomodoro suggestion applied:', {
          suggestion: suggestion,
          workDuration: suggestion.workDuration,
          breakDuration: suggestion.breakDuration
        });
        
        // Set AI-determined durations
        if (suggestion.workDuration && suggestion.breakDuration) {
          setWorkDuration(suggestion.workDuration);
          setBreakDuration(suggestion.breakDuration);
          setTimeLeft(suggestion.workDuration * 60); // Update timer display
        }
        
        // Show elegant browser notification
        showElegantNotification(suggestion);
      } catch (error) {
        console.error('❌ [CLIENT] Failed to get Pomodoro suggestion:', {
          error: error.message,
          errorStack: error.stack,
          upcomingEvents: upcomingSoon.map(e => e.summary)
        });
        // Fallback to default suggestion
        const fallbackSuggestion = {
          message: `You have ${newEvents.length} upcoming event(s) in the next 5 minutes. Would you like to start a Pomodoro work session?`,
          workDuration: 15, // Default fallback
          breakDuration: 3, // Default fallback
          focus: 'Focus on preparation for your upcoming event',
          preparation: 'Review your notes and prepare any materials needed'
        };
        setWorkDuration(15);
        setBreakDuration(3);
        setTimeLeft(15 * 60);
        showElegantNotification(fallbackSuggestion);
      }
    }
  };

  // Get AI suggestion for Pomodoro sessions
  const getPomodoroSuggestion = async (upcomingEvents) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    console.log('🍅 [CLIENT] Getting Pomodoro suggestion:', {
      requestId,
      upcomingEventsCount: upcomingEvents?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    // Debug: Log the actual event timing information
    console.log('⏰ [CLIENT] Event timing details:', {
      requestId,
      events: upcomingEvents.map(event => ({
        title: event.summary,
        startTime: event.start.dateTime || event.start.date,
        endTime: event.end.dateTime || event.end.date,
        parsedStart: new Date(event.start.dateTime || event.start.date).toISOString(),
        parsedEnd: new Date(event.end.dateTime || event.end.date).toISOString(),
        timeUntilEvent: Math.round((new Date(event.start.dateTime || event.start.date) - new Date()) / (1000 * 60))
      }))
    });
    // Helper function to determine event type
    const determineEventType = (event) => {
      const title = event.summary?.toLowerCase() || '';
      const description = event.description?.toLowerCase() || '';
      const location = event.location?.toLowerCase() || '';
      
      if (title.includes('meeting') || title.includes('call') || title.includes('zoom') || title.includes('teams') || title.includes('google meet')) {
        return 'meeting';
      } else if (title.includes('presentation') || title.includes('demo') || title.includes('pitch')) {
        return 'presentation';
      } else if (title.includes('interview') || title.includes('job') || title.includes('career')) {
        return 'interview';
      } else if (title.includes('deadline') || title.includes('due') || title.includes('submit')) {
        return 'deadline';
      } else if (title.includes('appointment') || title.includes('doctor') || title.includes('dentist')) {
        return 'appointment';
      } else if (title.includes('lunch') || title.includes('dinner') || title.includes('coffee')) {
        return 'social';
      } else if (title.includes('workout') || title.includes('gym') || title.includes('exercise')) {
        return 'fitness';
      } else if (title.includes('travel') || title.includes('flight') || title.includes('trip')) {
        return 'travel';
      } else if (event.attendees && event.attendees.length > 0) {
        return 'meeting';
      } else if (event.location && event.location !== 'No location specified') {
        return 'in-person';
      } else {
        return 'task';
      }
    };

    const eventDetails = upcomingEvents.map(event => {
      const startTime = new Date(event.start.dateTime || event.start.date);
      const endTime = new Date(event.end.dateTime || event.end.date);
      const durationMs = endTime - startTime;
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      const timeUntilEvent = Math.round((startTime - new Date()) / (1000 * 60));
      
      // Validate timing calculations
      if (timeUntilEvent < 0) {
        console.warn('⚠️ [CLIENT] Event has already started:', {
          title: event.summary,
          startTime: startTime.toISOString(),
          timeUntilEvent: timeUntilEvent
        });
      }
      
      return {
        title: event.summary,
        description: event.description || 'No description provided',
        time: startTime.toLocaleTimeString(),
        date: startTime.toLocaleDateString(),
        duration: `${durationMinutes} minutes`,
        durationMinutes: durationMinutes,
        timeUntilEvent: Math.max(0, timeUntilEvent), // Ensure non-negative
        location: event.location || 'No location specified',
        attendees: event.attendees ? event.attendees.length : 0,
        isAllDay: !event.start.dateTime,
        hasReminders: event.reminders && event.reminders.overrides && event.reminders.overrides.length > 0,
        eventType: determineEventType(event)
      };
    });

    const userLang = detectUserLanguage();
    
    try {
      console.log('🤖 [CLIENT] Sending Pomodoro suggestion request:', {
        requestId,
        url: '/api/ai/pomodoro-suggestion',
        method: 'POST',
        sessionId: sessionId?.substring(0, 8) + '...',
        isInitialized: pomodoroSessionInitialized,
        requestBody: {
          upcomingEvents: eventDetails,
          userLanguage: userLang,
          initializeSession: !pomodoroSessionInitialized
        }
      });
      
      const response = await fetch('/api/ai/pomodoro-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          upcomingEvents: eventDetails,
          userLanguage: userLang,
          initializeSession: !pomodoroSessionInitialized
        })
      });

      console.log('📡 [CLIENT] Pomodoro suggestion response received:', {
        requestId,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [CLIENT] Pomodoro suggestion request failed:', {
          requestId,
          status: response.status,
          statusText: response.statusText,
          errorText: errorText
        });
        throw new Error(`Failed to get suggestion: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log('✅ [CLIENT] Pomodoro suggestion data received:', {
        requestId,
        data: data,
        messageLength: data.message?.length || 0,
        workDuration: data.workDuration,
        breakDuration: data.breakDuration
      });
      
        // Mark session as initialized after first successful request
  if (!pomodoroSessionInitialized) {
    setPomodoroSessionInitialized(true);
    console.log('🔄 [CLIENT] Pomodoro session initialized');
  }
  
  // Reset session if we get an error indicating session needs reinitialization
  if (data.error === 'System prompt not initialized') {
    setPomodoroSessionInitialized(false);
    console.log('🔄 [CLIENT] Resetting Pomodoro session due to initialization error');
  }
      
      return data;
    } catch (error) {
      console.error('❌ [CLIENT] Pomodoro suggestion error:', {
        requestId,
        error: error.message,
        errorStack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  };

  // Show elegant Pomodoro notification overlay
  const showElegantNotification = (suggestion) => {
    setPomodoroNotificationData(suggestion);
    setShowPomodoroNotification(true);
    // No auto-close - user must manually close or start Pomodoro
  };

  // Pomodoro timer effect
  useEffect(() => {
    if (isRunning) {
      pomodoroIntervalRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            // Timer finished
            if (pomodoroState === 'work') {
              setPomodoroState('break');
              setTimeLeft(breakDuration * 60); // Use AI-determined break duration
              // Play notification sound or show notification with user's language
              const userLang = detectUserLanguage();
              const texts = getPomodoroTexts(userLang);
              const breakTexts = {
                en: { title: '🍅 Work Session Complete!', message: `Work session complete! Time for a ${breakDuration}-minute break.` },
                zh: { title: '🍅 工作时段完成！', message: `工作时段完成！该休息${breakDuration}分钟了。` },
                ja: { title: '🍅 作業セッション完了！', message: `作業セッション完了！${breakDuration}分間の休憩時間です。` },
                ko: { title: '🍅 작업 세션 완료!', message: `작업 세션 완료! ${breakDuration}분 휴식 시간입니다.` },
                es: { title: '🍅 ¡Sesión de Trabajo Completada!', message: `¡Sesión de trabajo completada! Tiempo para un descanso de ${breakDuration} minutos.` },
                fr: { title: '🍅 Session de Travail Terminée !', message: `Session de travail terminée ! Temps pour une pause de ${breakDuration} minutes.` },
                de: { title: '🍅 Arbeitssitzung Abgeschlossen!', message: `Arbeitssitzung abgeschlossen! Zeit für eine ${breakDuration}-minütige Pause.` }
              };
              const breakNotification = breakTexts[userLang] || breakTexts.en;
              showPomodoroBrowserNotification(breakNotification.title, breakNotification.message);
            } else {
              setPomodoroState('idle');
              setTimeLeft(workDuration * 60); // Use AI-determined work duration
              setIsRunning(false);
              // Play notification sound or show notification with user's language
              const userLang = detectUserLanguage();
              const breakCompleteTexts = {
                en: { title: '🍅 Break Complete!', message: 'Break complete! Ready for next work session.' },
                zh: { title: '🍅 休息完成！', message: '休息完成！准备开始下一个工作时段。' },
                ja: { title: '🍅 休憩完了！', message: '休憩完了！次の作業セッションの準備ができました。' },
                ko: { title: '🍅 휴식 완료!', message: '휴식 완료! 다음 작업 세션을 준비하세요.' },
                es: { title: '🍅 ¡Descanso Completado!', message: '¡Descanso completado! Listo para la próxima sesión de trabajo.' },
                fr: { title: '🍅 Pause Terminée !', message: 'Pause terminée ! Prêt pour la prochaine session de travail.' },
                de: { title: '🍅 Pause Abgeschlossen!', message: 'Pause abgeschlossen! Bereit für die nächste Arbeitssitzung.' }
              };
              const breakCompleteNotification = breakCompleteTexts[userLang] || breakCompleteTexts.en;
              showPomodoroBrowserNotification(breakCompleteNotification.title, breakCompleteNotification.message);
            }
            return prev;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    }

    return () => {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    };
  }, [isRunning, pomodoroState, workDuration, breakDuration]);

  // Check for upcoming events every 10 seconds
  useEffect(() => {
    const checkInterval = setInterval(checkUpcomingEvents, 10000); // Check every 10 seconds
    return () => clearInterval(checkInterval);
  }, [events, pomodoroState, showPomodoroSuggestion]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isTyping) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: inputMessage
    };

    setChatMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsTyping(true);

    try {
      // Get AI suggestion
      const result = await getAISuggestions(inputMessage, 'User wants to schedule this event');
      
      let aiMessage;
      
      if (result.shouldSchedule === false) {
        // AI determined no event should be scheduled
        aiMessage = {
          id: Date.now() + 1,
          type: 'ai',
          content: result.message
        };
        setChatMessages(prev => [...prev, aiMessage]);
      } else {
        // AI determined events should be scheduled - automatically create them
        const events = result.events || [result];
        const eventCount = events.length;
        
        // Show initial suggestion message
        let content = '';
        if (eventCount === 1) {
          const event = events[0];
          content = `Perfect! I've found a great time for your event:\n\n📅 **${event.title}**\n⏰ **${format(new Date(event.suggestedTime), 'EEEE, MMMM d, yyyy')} at ${format(new Date(event.suggestedTime), 'h:mm a')}**\n⏱️ **Duration:** ${event.duration}\n${event.location ? `📍 **Location:** ${event.location}\n` : ''}${event.attendees && event.attendees.length > 0 ? `👥 **Attendees:** ${event.attendees.length} people\n` : ''}\n💭 **Why this time?** ${event.reasoning}\n\nAdding this to your calendar now... ✨`;
        } else {
          content = `Great! I've found ${eventCount} perfect times for your events:\n\n`;
          events.forEach((event, index) => {
            content += `**${index + 1}. ${event.title}**\n`;
            content += `📅 ${format(new Date(event.suggestedTime), 'EEEE, MMMM d')} at ${format(new Date(event.suggestedTime), 'h:mm a')}\n`;
            content += `⏱️ ${event.duration}`;
            if (event.location) content += ` | 📍 ${event.location}`;
            content += `\n💭 ${event.reasoning}\n\n`;
          });
          content += `Adding all ${eventCount} events to your calendar now... ✨`;
        }
        
        aiMessage = {
          id: Date.now() + 1,
          type: 'ai',
          content: content
        };
        setChatMessages(prev => [...prev, aiMessage]);
        
        // Automatically create the events
        await createEventFromSuggestion(eventCount === 1 ? events[0] : events);
      }
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: "Oops! I'm having a little trouble understanding that right now. Could you try rephrasing it? For example, you could say 'Schedule a meeting tomorrow' or 'Remind me to call mom on Friday'. I'm here to help! 😊"
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const createEventFromSuggestion = async (suggestion) => {
    try {
      const events = Array.isArray(suggestion) ? suggestion : [suggestion];
      const eventCount = events.length;
      
      let createdCount = 0;
      const createdEvents = [];
      
      for (const event of events) {
        const startTime = new Date(event.suggestedTime);
        const [hours, minutes] = event.duration.split(':').map(Number);
        const endTime = new Date(startTime.getTime() + (hours * 60 + minutes) * 60 * 1000);

        const eventData = {
          title: event.title,
          description: event.description,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          location: event.location,
          attendees: event.attendees || [],
          reminders: event.reminders || ['15 minutes before']
        };

        console.log('🔄 [DASHBOARD] Creating event with data:', {
          title: eventData.title,
          startTime: eventData.startTime,
          endTime: eventData.endTime,
          location: eventData.location,
          attendeesCount: eventData.attendees.length,
          reminders: eventData.reminders
        });

        await createEvent(eventData);
        createdCount++;
        createdEvents.push(event.title);
      }
      
      let confirmationMessage;
      if (eventCount === 1) {
        const event = events[0];
        const startTime = new Date(event.suggestedTime);
        confirmationMessage = {
          id: Date.now(),
          type: 'ai',
          content: `🎉 Perfect! "${event.title}" has been successfully added to your calendar for ${format(startTime, 'EEEE, MMMM d, yyyy')} at ${format(startTime, 'h:mm a')}. You're all set! ✨`
        };
      } else {
        confirmationMessage = {
          id: Date.now(),
          type: 'ai',
          content: `🎉 Excellent! I've successfully added ${createdCount} events to your calendar:\n\n${createdEvents.map((title, index) => `✅ ${index + 1}. ${title}`).join('\n')}\n\nYou're all organized and ready to go! ✨`
        };
      }
      
      setChatMessages(prev => [...prev, confirmationMessage]);
    } catch (error) {
      console.error('❌ [DASHBOARD] Error creating events:', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack
      });
      
      const errorMessage = {
        id: Date.now(),
        type: 'ai',
        content: "Oops! I ran into a little issue creating your event(s). Don't worry though - you can try again, or let me know if you'd like to adjust anything! 😊"
      };
      setChatMessages(prev => [...prev, errorMessage]);
    }
  };

  const upcomingEvents = getUpcomingEvents();

  return (
    <div className="space-y-2 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-base font-medium text-gray-700">Vibe Calendar by Dorian</h1>
        <div className="flex items-center space-x-2">
          {sessionId && (
            <button
              onClick={disconnectGoogleCalendar}
              className="px-2 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Disconnect Google Calendar"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {/* Upcoming Events Section */}
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
              <Calendar className="h-3 w-3" />
              <span>{user?.name ? `${user.name}'s Upcoming Events` : 'Upcoming Events'}</span>
            </h2>
            {loading && (
              <div className="text-xs text-gray-500">Loading...</div>
            )}
          </div>
          
          {(() => {
            const eventsByDay = getEventsByDay();
            const hasEvents = Object.values(eventsByDay).some(dayEvents => dayEvents.length > 0);
            
            if (hasEvents) {
              return (
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(eventsByDay).map(([dateKey, dayEvents]) => {
                    const date = new Date(dateKey);
                    const isTodayDate = isToday(date);
                    const isTomorrowDate = isTomorrow(date);
                    
                    return (
                      <div key={dateKey} className="space-y-1">
                        <div className="text-center">
                          <div className={`text-xs font-medium ${isTodayDate ? 'text-primary-600' : 'text-gray-700'}`}>
                            {isTodayDate ? 'Today' : isTomorrowDate ? 'Tomorrow' : format(date, 'EEE')}
                          </div>
                          <div className="text-xs text-gray-500">
                            {format(date, 'MMM d')}
                          </div>
                        </div>
                        
                        <div className="space-y-0.5">
                          {dayEvents.length > 0 ? (
                            dayEvents.map((event) => (
                              <div key={event.id} className="p-1 bg-gray-50 rounded text-xs">
                                <div className="font-medium text-gray-900 truncate">
                                  {event.summary}
                                </div>
                                <div className="text-gray-500">
                                  {getEventTime(event)}
                                </div>
                                {event.location && (
                                  <div className="text-gray-400 truncate">
                                    📍 {event.location}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-1 text-gray-400 text-xs">
                              No events
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            } else {
              return (
                <div className="text-center py-3">
                  <Calendar className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                  <p className="text-gray-500 text-xs">No upcoming events</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {sessionId ? "Try asking me to schedule something!" : "Connect your Google Calendar to see events"}
                  </p>
                </div>
              );
            }
          })()}
        </div>

        {/* Pomodoro timer only shows in notification overlay - no main page timer */}

        {/* AI Chat Section */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-1">
            <MessageCircle className="h-3 w-3 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">AI Assistant</h2>
          </div>
          
          {/* Chat Messages */}
          <div ref={chatContainerRef} className="h-28 overflow-y-auto mb-1 space-y-1">
            {chatMessages.length === 0 ? (
              <div className="flex justify-center items-center h-full">
                <div className="text-center text-gray-500">
                  <MessageCircle className="h-5 w-5 mx-auto mb-1 text-gray-400" />
                  <p className="text-xs">Hi there! 👋 I'm your friendly calendar assistant</p>
                  <p className="text-xs text-gray-400 mt-1">Just tell me what you'd like to schedule!</p>
                </div>
              </div>
            ) : (
              chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`chat-message ${
                      message.type === 'user' ? 'user' : 'ai'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </div>
                </div>
              ))
            )}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-900 px-2 py-1 rounded-lg">
                  <div className="flex space-x-1">
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendMessage} className="flex space-x-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="What would you like to schedule? 😊"
              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-primary-500 focus:border-transparent"
              disabled={isTyping}
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || isTyping}
              className="px-2 py-1 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="h-3 w-3" />
            </button>
            {pomodoroState === 'idle' && (
              <button
                type="button"
                onClick={startPomodoro}
                className="px-2 py-1 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                title="Start Pomodoro Timer"
              >
                🍅
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Pomodoro timer only shows in notification overlay - no main page timer */}

      {/* Pomodoro Notification Overlay */}
      {showPomodoroNotification && pomodoroNotificationData && (() => {
        const userLang = detectUserLanguage();
        const texts = getPomodoroTexts(userLang);
        
        return (
          <div className="fixed inset-0 bg-gray-900 bg-opacity-60 z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl p-8 shadow-2xl max-w-sm mx-4 text-center">
              <div className="text-5xl mb-6">🍅</div>
              
              {/* Show Timer if Pomodoro is running */}
              {pomodoroState !== 'idle' && isRunning ? (
                <>
                  <div className={`text-4xl font-bold mb-4 ${pomodoroState === 'work' ? 'text-red-600' : 'text-green-600'}`}>
                    {formatTime(timeLeft)}
                  </div>
                  <div className="text-lg text-gray-600 mb-6">
                    {pomodoroState === 'work' ? `${workDuration}min Focus Time` : `${breakDuration}min Break Time`}
                  </div>
                  
                  {/* Timer Controls */}
                  <div className="flex justify-center space-x-3 mb-6">
                    <button
                      onClick={pausePomodoro}
                      className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors flex items-center space-x-2"
                    >
                      <Pause className="h-4 w-4" />
                      <span>Pause</span>
                    </button>
                    <button
                      onClick={resetPomodoro}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>Stop</span>
                    </button>
                  </div>
                  
                  <div className="text-sm text-gray-500 mb-6">
                    {pomodoroState === 'work' ? 'Stay focused! You can do this! 💪' : 'Take a well-deserved break! 😌'}
                  </div>
                </>
              ) : (
                <>
                  {/* Main Message */}
                  <div className="text-lg font-medium text-gray-800 mb-4 leading-relaxed">
                    {pomodoroNotificationData.message}
                  </div>
                  
                  {/* Focus & Preparation */}
                  {(pomodoroNotificationData.focus || pomodoroNotificationData.preparation) && (
                    <div className="text-sm text-gray-600 mb-6 space-y-1">
                      {pomodoroNotificationData.focus && (
                        <div>🎯 {pomodoroNotificationData.focus}</div>
                      )}
                      {pomodoroNotificationData.preparation && (
                        <div>📝 {pomodoroNotificationData.preparation}</div>
                      )}
                    </div>
                  )}
                  
                  {/* Simple Session Info */}
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 mb-6">
                    <div className="flex justify-center items-center space-x-6 text-sm">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{pomodoroNotificationData.workDuration}</div>
                        <div className="text-gray-600">min work</div>
                      </div>
                      <div className="text-gray-400">+</div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{pomodoroNotificationData.breakDuration}</div>
                        <div className="text-gray-600">min break</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        startPomodoro();
                        setShowPomodoroNotification(false);
                        setPomodoroNotificationData(null);
                      }}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-sm font-medium"
                    >
                      {texts.startButton}
                    </button>
                    <button
                      onClick={() => {
                        setShowPomodoroNotification(false);
                        setPomodoroNotificationData(null);
                      }}
                      className="px-6 py-3 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                    >
                      {texts.notNowButton}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Dashboard; 