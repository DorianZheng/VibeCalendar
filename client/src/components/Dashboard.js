import React, { useEffect, useState, useRef } from 'react';
import {
  Calendar,
  Clock,
  Send,
  MessageCircle,
  Play,
  Pause,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useCalendar } from '../context/CalendarContext';
import { format, isToday, isTomorrow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const Dashboard = () => {
  const {
    events,
    fetchEvents,
    getAISuggestions,
    createEvent,
    confirmAIAction,
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
  const [hasAttemptedUserFetch, setHasAttemptedUserFetch] = useState(false);
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
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [pomodoroSessionInitialized, setPomodoroSessionInitialized] = useState(false); // Track if system prompt was sent
  const [lastEventCount, setLastEventCount] = useState(0); // Track event count for auto-refresh
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



  useEffect(() => {
    // Only fetch events if we have a validated session and haven't attempted yet
    if (sessionId && isGoogleConnected && sessionValidated && !hasAttemptedFetch) {
      setHasAttemptedFetch(true);
      // Add a small delay to ensure axios headers are properly set
      setTimeout(() => {
        fetchEvents();
      }, 200);
    }
  }, [sessionId, isGoogleConnected, sessionValidated, hasAttemptedFetch]); // Removed fetchEvents from dependencies to prevent infinite loop

  // Check if event count has changed (indicating new events were added)
  useEffect(() => {
    console.log('🔍 [DASHBOARD] Event count check:', {
      currentCount: events.length,
      lastCount: lastEventCount,
      hasChanged: events.length !== lastEventCount,
      events: events.map(e => ({ id: e.id, title: e.summary, start: e.start?.dateTime || e.start?.date }))
    });

    if (events.length !== lastEventCount) {
      console.log('🔄 [DASHBOARD] Event count changed, triggering refresh:', {
        previousCount: lastEventCount,
        newCount: events.length,
        difference: events.length - lastEventCount
      });
      setLastEventCount(events.length);

      // Force a re-fetch of events to ensure we have the latest data
      // Use a longer delay to ensure Google Calendar API has propagated changes
      setTimeout(() => {
        console.log('🔄 [DASHBOARD] Executing delayed event refresh');
        fetchEvents(undefined, undefined, false); // Background refresh, no loading indicator
      }, 2000); // Increased delay to 2 seconds
    }
  }, [events, lastEventCount, fetchEvents]);



  // Reset Pomodoro session when Google Calendar connection changes
  useEffect(() => {
    if (sessionId) {
      setPomodoroSessionInitialized(false);
    }
  }, [sessionId]);

  // Periodic event refresh (fallback for webhooks)
  useEffect(() => {
    if (!sessionId || !isGoogleConnected) return;

    const refreshInterval = setInterval(() => {
      fetchEvents(undefined, undefined, false); // Background refresh, no loading indicator
    }, 5 * 60 * 1000); // Refresh every 5 minutes

    return () => clearInterval(refreshInterval);
  }, [sessionId, isGoogleConnected, fetchEvents]);

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

  // Auto-scroll to the first line of new message bubbles
  useEffect(() => {
    if (chatContainerRef.current && chatMessages.length > 0) {
      // Find the last message element
      const messageElements = chatContainerRef.current.querySelectorAll('[data-message-index]');
      if (messageElements.length > 0) {
        const lastMessageElement = messageElements[messageElements.length - 1];
        // Scroll to the top of the last message (first line)
        lastMessageElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }
    }
  }, [chatMessages, isTyping]);

  // Fetch user information when session is validated (optional) - only once
  useEffect(() => {
    if (sessionId && isGoogleConnected && sessionValidated && !user && !hasAttemptedUserFetch) {
      setHasAttemptedUserFetch(true);
      // Add a delay to ensure session is fully established
      setTimeout(() => {
        fetchUserInfo().catch(error => {
          // Silent fail for user info fetch
        });
      }, 1000); // Increased delay to ensure session is stable
    }
  }, [sessionId, isGoogleConnected, sessionValidated, user, fetchUserInfo, hasAttemptedUserFetch]);

  const getUpcomingEvents = () => {
    const today = new Date();
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const upcoming = events
      .filter(event => {
        const eventDate = new Date(event.start.dateTime || event.start.date);
        return eventDate >= today && eventDate <= thirtyDaysFromNow;
      })
      .sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

    return upcoming;
  };

  const getEventsByDay = () => {
    const events = getUpcomingEvents();
    const eventsByDay = {};

    // Get unique dates from events (up to 30 days)
    const uniqueDates = new Set();
    events.forEach(event => {
      const eventDate = new Date(event.start.dateTime || event.start.date);
      const dateKey = eventDate.toDateString();
      uniqueDates.add(dateKey);
    });

    // Sort dates chronologically and take the first 14 days (to fit on screen)
    const sortedDates = Array.from(uniqueDates)
      .map(dateKey => new Date(dateKey))
      .sort((a, b) => a - b)
      .map(date => date.toDateString())
      .slice(0, 14);

    // Initialize days with events
    sortedDates.forEach(dateKey => {
      eventsByDay[dateKey] = [];
    });

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
    setShowPomodoroNotification(false); // Close notification if open
    setPomodoroNotificationData(null);

    console.log('✅ [CLIENT] Pomodoro started successfully');
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
    console.log('⏰ [CLIENT] Pomodoro timer effect triggered:', {
      isRunning,
      pomodoroState,
      workDuration,
      breakDuration,
      timeLeft,
      hasInterval: !!pomodoroIntervalRef.current
    });

    if (isRunning) {
      console.log('🔄 [CLIENT] Starting Pomodoro timer interval');
      pomodoroIntervalRef.current = setInterval(() => {
        setTimeLeft(prev => {
          console.log('⏱️ [CLIENT] Timer tick:', {
            currentTime: prev,
            pomodoroState,
            workDuration,
            breakDuration
          });

          if (prev <= 1) {
            // Timer finished
            if (pomodoroState === 'work') {
              console.log('✅ [CLIENT] Work session complete, starting break');
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
              console.log('✅ [CLIENT] Break complete, returning to idle');
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
        console.log('⏹️ [CLIENT] Clearing Pomodoro timer interval');
        clearInterval(pomodoroIntervalRef.current);
      }
    }

    return () => {
      if (pomodoroIntervalRef.current) {
        console.log('🧹 [CLIENT] Cleaning up Pomodoro timer interval');
        clearInterval(pomodoroIntervalRef.current);
      }
    };
  }, [isRunning, pomodoroState, workDuration, breakDuration]);

  // Check for upcoming events every 10 seconds
  useEffect(() => {
    const checkInterval = setInterval(checkUpcomingEvents, 10000); // Check every 10 seconds
    return () => clearInterval(checkInterval);
  }, [events, pomodoroState, showPomodoroSuggestion]);

  // Handle SSE streaming request
  const handleSSERequest = (inputValue) => {
    return new Promise((resolve, reject) => {
      console.log('🚀 [DASHBOARD] Starting SSE request for:', inputValue);

      // Track if this SSE session used any tools
      let usedToolsInThisSession = false;

      // Create EventSource for SSE
      const eventSource = new EventSource(`http://localhost:50001/api/ai/schedule-stream?${new URLSearchParams({
        description: inputValue,
        sessionId: sessionId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })}`);

      eventSource.onopen = () => {
        console.log('✅ [DASHBOARD] SSE connection opened');
      };

      eventSource.onmessage = (event) => {
        console.log('📨 [DASHBOARD] SSE message received:', event.data);

        try {
          const data = JSON.parse(event.data);

          if (data.type === 'intermittent') {
            console.log('⚡ [DASHBOARD] Showing intermittent message:', data.message);
            console.log('🔧 [DASHBOARD] Tools running:', data.tools);

            // Track that this SSE session used tools
            if (data.tools && data.tools.length > 0) {
              usedToolsInThisSession = true;
              console.log('🔧 [DASHBOARD] Marking SSE session as using tools');
            }

            // Add intermittent message immediately
            const messageId = Date.now();
            setChatMessages(prev => [...prev, {
              id: messageId,
              type: 'ai',
              content: data.message,
              isProcessing: true,
              tools: data.tools || []
            }]);

          } else if (data.type === 'confirmation') {
            console.log('⚠️ [DASHBOARD] Tools require confirmation:', data.tools);
            // Add confirmation message with special UI
            const messageId = Date.now();
            setChatMessages(prev => [...prev, {
              id: messageId,
              type: 'ai',
              content: data.message,
              requiresConfirmation: true,
              tools: data.tools,
              isProcessing: false
            }]);
            eventSource.close();
            setIsTyping(false);
            resolve();

          } else if (data.type === 'final') {
            console.log('✅ [DASHBOARD] Showing final message:', data.message);
            // Clear processing state from intermittent messages and add final message
            setChatMessages(prev => {
              const updated = prev.map(msg =>
                msg.isProcessing
                  ? { ...msg, isProcessing: false }
                  : msg
              );
              return [...updated, {
                id: Date.now() + Math.random(),
                type: 'ai',
                content: data.message,
                isProcessing: false,
                tools: [] // No tools for final message
              }];
            });

            // Check if any tools were used in this SSE session (indicating events might have been created)
            if (usedToolsInThisSession) {
              console.log('🔄 [DASHBOARD] SSE session used tools, refreshing events...');
              // Immediate refresh to catch newly created events quickly
              setTimeout(() => {
                console.log('📅 [DASHBOARD] Executing immediate post-SSE event refresh');
                fetchEvents(undefined, undefined, false); // Background refresh, no loading indicator
              }, 500);

              // Second refresh with longer delay to ensure Google Calendar has fully propagated changes
              setTimeout(() => {
                console.log('📅 [DASHBOARD] Executing delayed post-SSE event refresh');
                fetchEvents(undefined, undefined, false); // Background refresh, no loading indicator
              }, 3000);
            }

            eventSource.close();
            setIsTyping(false);
            resolve();

          } else if (data.type === 'error') {
            console.error('❌ [DASHBOARD] SSE error:', data.message);
            setChatMessages(prev => [...prev, {
              id: Date.now(),
              type: 'ai',
              content: data.message,
              isProcessing: false
            }]);
            eventSource.close();
            setIsTyping(false);
            reject(new Error(data.message));
          }
        } catch (parseError) {
          console.error('❌ [DASHBOARD] Error parsing SSE data:', parseError);
          setIsTyping(false);
          reject(parseError);
        }
      };

      eventSource.onerror = (error) => {
        console.error('❌ [DASHBOARD] SSE error:', error);
        eventSource.close();
        setIsTyping(false);
        setChatMessages(prev => [...prev, {
          id: Date.now(),
          type: 'ai',
          content: '连接出现问题，请稍后再试。',
          isProcessing: false
        }]);
        reject(error);
      };

      // Fallback: close connection after 60 seconds
      setTimeout(() => {
        if (eventSource.readyState !== EventSource.CLOSED) {
          eventSource.close();
          setIsTyping(false);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  };

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
      // Use SSE for streaming AI responses
      await handleSSERequest(inputMessage);
      // SSE handles all messages, no additional processing needed
    } catch (error) {
      console.error('❌ [DASHBOARD] AI request failed:', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      let errorContent = "I'm having trouble processing your request right now. ";

      if (error.response?.status === 429) {
        errorContent += "The AI service is busy. Please wait a moment and try again.";
      } else if (error.response?.status === 503) {
        errorContent += "The AI service is temporarily unavailable. Please try again later.";
      } else if (error.message && (error.message.includes('fetch failed') || error.message.includes('network'))) {
        errorContent += "There's a network connection issue. Please check your internet connection.";
      } else {
        errorContent += "Could you try rephrasing your request? For example: 'Schedule a meeting tomorrow' or 'Show my events for this week'.";
      }

      const errorMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: errorContent
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleOverlapChoice = async (choice, overlapEvents, overlaps) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    console.log('🔄 [DASHBOARD] Handling overlap choice:', {
      requestId,
      choice,
      overlapEventsCount: overlapEvents?.length || 0,
      overlapsCount: overlaps?.length || 0
    });

    try {
      let aiMessage;

      switch (choice) {
        case 'reschedule':
          // Ask AI to reschedule to different times
          aiMessage = {
            id: Date.now() + 1,
            type: 'ai',
            content: "I'll help you find a better time that doesn't conflict with your existing events. Let me look for alternative slots... 🔄"
          };
          setChatMessages(prev => [...prev, aiMessage]);

          // For now, show a simple message about rescheduling
          setTimeout(() => {
            const newAiMessage = {
              id: Date.now() + 2,
              type: 'ai',
              content: "I've noted your preference to reschedule conflicting events. You can manually reschedule them in your calendar, or try asking me to 'Schedule [event] at a different time' for specific events."
            };
            setChatMessages(prev => [...prev, newAiMessage]);
          }, 1000);
          break;

        case 'cancel_conflicting':
          // Cancel conflicting events and create new ones
          aiMessage = {
            id: Date.now() + 1,
            type: 'ai',
            content: "I'll cancel the conflicting events and create your new events. This will remove the overlapping events from your calendar. ⚠️"
          };
          setChatMessages(prev => [...prev, aiMessage]);

          // TODO: Implement event deletion functionality
          // For now, just create the new events
          await createEventFromSuggestion(overlapEvents);

          const successMessage = {
            id: Date.now() + 2,
            type: 'ai',
            content: "✅ Your new events have been created! Note: You may need to manually delete the conflicting events from your calendar."
          };
          setChatMessages(prev => [...prev, successMessage]);
          break;

        case 'create_anyway':
          // Create overlapping events anyway
          aiMessage = {
            id: Date.now() + 1,
            type: 'ai',
            content: "Creating your events with the overlapping times. You'll have multiple events at the same time in your calendar. ⚠️"
          };
          setChatMessages(prev => [...prev, aiMessage]);

          await createEventFromSuggestion(overlapEvents);

          const createdMessage = {
            id: Date.now() + 2,
            type: 'ai',
            content: "✅ Your events have been created! You now have overlapping events in your calendar."
          };
          setChatMessages(prev => [...prev, createdMessage]);
          break;
      }
    } catch (error) {
      console.error('❌ [DASHBOARD] Error handling overlap choice:', {
        requestId,
        choice,
        error: error.message
      });

      const errorMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: "Sorry, I encountered an error while handling your choice. Please try again or let me know if you need help!"
      };
      setChatMessages(prev => [...prev, errorMessage]);
    }
  };



  const handleConfirmActions = async (tools, messageId) => {
    try {
      console.log('✅ [DASHBOARD] User confirmed actions:', {
        messageId,
        toolCount: tools?.length || 0,
        tools: tools?.map(t => t.tool)
      });

      // Update message to show processing
      setChatMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            content: "⏳ Executing operations...",
            isProcessing: true,
            requiresConfirmation: false
          }
          : msg
      ));

      // Call confirmation endpoint
      const response = await fetch('/api/ai/confirm-tools', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          tools: tools,
          confirmed: true,
          originalMessage: inputMessage
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to confirm tools: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      console.log('✅ [DASHBOARD] Tool confirmation completed:', {
        success: result.success,
        messageLength: result.message?.length || 0
      });

      // Update message with final result
      setChatMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            content: result.message,
            isProcessing: false,
            isCompleted: true,
            requiresConfirmation: false,
            tools: undefined
          }
          : msg
      ));

      // Refresh events after successful operations
      setTimeout(() => {
        console.log('📅 [DASHBOARD] Refreshing events after confirmed operations');
        fetchEvents(undefined, undefined, false);
      }, 1000);

    } catch (error) {
      console.error('❌ [DASHBOARD] Error confirming actions:', error);

      // Update message to show error
      setChatMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            content: `❌ Failed to execute operations: ${error.message}`,
            isProcessing: false,
            isCompleted: false,
            requiresConfirmation: false,
            tools: undefined
          }
          : msg
      ));
    }
  };

  const handleCancelActions = async (tools, messageId) => {
    try {
      console.log('❌ [DASHBOARD] User cancelled actions:', {
        messageId,
        toolCount: tools?.length || 0
      });

      // Update message to show processing cancellation
      setChatMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            content: "❌ Cancelling operations...",
            isProcessing: true,
            requiresConfirmation: false
          }
          : msg
      ));

      // Call confirmation endpoint with cancelled=false
      const response = await fetch('/api/ai/confirm-tools', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          tools: tools,
          confirmed: false,
          originalMessage: inputMessage
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel tools: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      console.log('✅ [DASHBOARD] Tool cancellation completed:', {
        success: result.success,
        cancelled: result.cancelled
      });

      // Update message with cancellation result
      setChatMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            content: result.message || "❌ Operations cancelled. No changes were made to your calendar.",
            isProcessing: false,
            isCompleted: false,
            requiresConfirmation: false,
            tools: undefined
          }
          : msg
      ));

    } catch (error) {
      console.error('❌ [DASHBOARD] Error cancelling actions:', error);

      // Update message to show error
      setChatMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
            ...msg,
            content: "❌ Error processing cancellation. Operations were not executed.",
            isProcessing: false,
            isCompleted: false,
            requiresConfirmation: false,
            tools: undefined
          }
          : msg
      ));
    }
  };

  const createEventFromSuggestion = async (suggestion) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    console.log('🎯 [DASHBOARD] Starting event creation from suggestion:', {
      requestId,
      suggestionType: Array.isArray(suggestion) ? 'array' : 'single',
      suggestionCount: Array.isArray(suggestion) ? suggestion.length : 1,
      originalSuggestion: suggestion
    });

    try {
      const events = Array.isArray(suggestion) ? suggestion : [suggestion];
      const eventCount = events.length;

      console.log('📋 [DASHBOARD] Processing events for creation:', {
        requestId,
        eventCount,
        events: events.map((event, index) => ({
          index: index + 1,
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          description: event.description?.substring(0, 50) + '...',
          location: event.location,
          attendeesCount: event.attendees?.length || 0,
          reminders: event.reminders
        }))
      });

      let createdCount = 0;
      const createdEvents = [];
      const failedEvents = [];

      for (const [index, event] of events.entries()) {
        console.log(`🔄 [DASHBOARD] Processing event ${index + 1}/${eventCount}:`, {
          requestId,
          eventIndex: index + 1,
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime
        });

        try {
          // AI already provided startTime and endTime, so we can use them directly
          const eventData = {
            title: event.title,
            description: event.description,
            startTime: event.startTime,
            endTime: event.endTime,
            location: event.location,
            attendees: event.attendees || [],
            reminders: event.reminders || ['15 minutes before']
          };

          console.log(`📝 [DASHBOARD] Event ${index + 1} data prepared:`, {
            requestId,
            eventIndex: index + 1,
            title: eventData.title,
            startTime: eventData.startTime,
            endTime: eventData.endTime,
            location: eventData.location,
            attendeesCount: eventData.attendees.length,
            reminders: eventData.reminders,
            duration: Math.round((new Date(eventData.endTime) - new Date(eventData.startTime)) / (1000 * 60)) + ' minutes'
          });

          const createdEvent = await createEvent(eventData, { skipRefresh: true, skipToast: true });
          createdCount++;
          createdEvents.push(event.title);

          console.log(`✅ [DASHBOARD] Event ${index + 1} created successfully:`, {
            requestId,
            eventIndex: index + 1,
            title: event.title,
            createdEventId: createdEvent?.id,
            createdEventSummary: createdEvent?.summary
          });
        } catch (eventError) {
          console.error(`❌ [DASHBOARD] Failed to create event ${index + 1}:`, {
            requestId,
            eventIndex: index + 1,
            title: event.title,
            error: eventError.message,
            errorStack: eventError.stack,
            errorResponse: eventError.response?.data,
            errorStatus: eventError.response?.status,
            errorStatusText: eventError.response?.statusText
          });
          failedEvents.push({
            title: event.title,
            error: eventError.message,
            status: eventError.response?.status
          });
        }
      }

      console.log('📊 [DASHBOARD] Event creation summary:', {
        requestId,
        totalEvents: eventCount,
        createdCount,
        failedCount: failedEvents.length,
        createdEvents,
        failedEvents
      });

      let confirmationMessage;
      if (failedEvents.length === 0) {
        // All events created successfully
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
      } else if (createdCount > 0) {
        // Some events created, some failed
        const successList = createdEvents.map((title, index) => `✅ ${index + 1}. ${title}`).join('\n');
        const failedList = failedEvents.map((item, index) => `❌ ${index + 1}. ${item.title} (${item.error})`).join('\n');

        confirmationMessage = {
          id: Date.now(),
          type: 'ai',
          content: `⚠️ Mixed results: I successfully created ${createdCount} event(s), but ${failedEvents.length} failed:\n\n**Created:**\n${successList}\n\n**Failed:**\n${failedList}\n\nYou can try creating the failed events again or let me know if you'd like to adjust anything! 😊`
        };
      } else {
        // All events failed
        const failedList = failedEvents.map((item, index) => `❌ ${index + 1}. ${item.title} (${item.error})`).join('\n');

        confirmationMessage = {
          id: Date.now(),
          type: 'ai',
          content: `❌ I couldn't create any of your events. Here's what went wrong:\n\n${failedList}\n\nPlease try again or let me know if you'd like to adjust anything! 😊`
        };
      }

      setChatMessages(prev => [...prev, confirmationMessage]);

      // Refresh events once after all events are processed
      if (createdCount > 0) {
        setTimeout(() => fetchEvents(), 1000);
      }
    } catch (error) {
      console.error('❌ [DASHBOARD] Unexpected error in event creation:', {
        requestId,
        error: error.message,
        errorStack: error.stack,
        status: error.response?.status,
        data: error.response?.data,
        errorResponse: error.response?.data,
        errorStatus: error.response?.status,
        errorStatusText: error.response?.statusText
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

  // Dropdown state for tools
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (toolsRef.current && !toolsRef.current.contains(event.target)) {
        setToolsOpen(false);
      }
    }
    if (toolsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [toolsOpen]);

  // Add a debug function to clear chat history (client + server)
  const handleClearChatHistory = async () => {
    if (!window.confirm('Are you sure you want to clear the entire conversation history? This cannot be undone.')) return;
    setChatMessages([]);
    if (sessionId) {
      try {
        await fetch('/api/debug/clear-history', {
          method: 'POST',
          headers: { 'x-session-id': sessionId }
        });
      } catch (err) {
        // Optionally show error to user
        console.error('Failed to clear server conversation history:', err);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden p-2">
      {/* Header */}
      <div className="flex items-center justify-between p-1 flex-shrink-0">
        <h1 className="text-sm font-normal text-gray-800">Vibe Calendar made by Dorian and his intern Cursor</h1>
        <div className="flex items-center space-x-2">
          {!isChatVisible && (
            <button
              onClick={() => setIsChatVisible(true)}
              className="p-2 text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              title="Show Chat"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          )}
          {sessionId && (
            <button
              onClick={disconnectGoogleCalendar}
              className="px-2 py-1 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Disconnect Google Calendar"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className={`flex gap-3 flex-1 min-h-0 ${isChatVisible ? 'flex-row' : 'flex-col'}`}>
        {/* Upcoming Events Section */}
        <div className={`card flex flex-col bg-white rounded-xl shadow-sm min-h-0 ${isChatVisible ? 'flex-[2]' : 'w-full'}`}>
          <div className="flex items-center justify-between p-1 flex-shrink-0">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-gray-600" />
              <div>
                <h2 className="text-sm font-normal text-gray-800">
                  {user?.name ? `${user.name}'s Schedule` : 'Upcoming Events'}
                </h2>
                <p className="text-xs text-gray-500">Upcoming events</p>
              </div>
            </div>
          </div>

          {(() => {
            const eventsByDay = getEventsByDay();
            const hasEvents = Object.values(eventsByDay).some(dayEvents => dayEvents.length > 0);

            if (hasEvents) {
              return (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-1 p-1 flex-1 overflow-y-auto min-h-0">
                  {Object.entries(eventsByDay).map(([dateKey, dayEvents]) => {
                    const date = new Date(dateKey);
                    const isTodayDate = isToday(date);
                    const isTomorrowDate = isTomorrow(date);

                    return (
                      <div key={dateKey} className="space-y-0.5">
                        <div className="text-center pb-1">
                          <div className={`text-sm font-normal ${isTodayDate ? 'text-blue-600' : 'text-gray-700'}`}>
                            {isTodayDate ? 'Today' : isTomorrowDate ? 'Tomorrow' : format(date, 'EEE')}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {format(date, 'MMM d')}
                          </div>
                        </div>

                        <div className="space-y-0.5">
                          {dayEvents.length > 0 ? (
                            dayEvents.map((event) => (
                              <div
                                key={event.id}
                                className="group relative bg-white border border-gray-100 rounded-2xl p-2 hover:bg-gray-50 hover:border-gray-200 transition-all duration-200 cursor-pointer"
                                title={event.description || event.location || event.attendees || event.reminders ? 'Hover for details' : ''}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-normal text-gray-800 text-xs leading-tight truncate mb-1">
                                      {event.summary}
                                    </div>
                                    <div className="text-xs text-gray-500 flex items-center space-x-1">
                                      <span className="flex items-center">
                                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {getEventTime(event)}
                                      </span>
                                      {event.location && (
                                        <span className="flex items-center">
                                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                          </svg>
                                          <span className="truncate">{event.location}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end space-y-1 ml-2">
                                    {event.recurringEventId && (
                                      <div className="w-2 h-2 bg-blue-500 rounded-full" title="Recurring event"></div>
                                    )}
                                    {event.transparency === 'transparent' && (
                                      <div className="w-2 h-2 bg-gray-400 rounded-full" title="Busy"></div>
                                    )}
                                    {event.transparency === 'opaque' && (
                                      <div className="w-2 h-2 bg-green-500 rounded-full" title="Available"></div>
                                    )}
                                  </div>
                                </div>

                                {/* Minimal elegant hover tooltip */}
                                {(event.description || event.location || event.attendees || event.reminders) && (
                                  <div
                                    className="fixed px-4 py-2 bg-white border border-gray-100 text-gray-800 text-sm rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50"
                                    style={{
                                      width: '250px',
                                      maxWidth: 'calc(100vw - 2rem)'
                                    }}
                                    onMouseEnter={(e) => {
                                      const eventRect = e.currentTarget.parentElement.getBoundingClientRect();
                                      const tooltip = e.currentTarget;
                                      const tooltipWidth = 250;
                                      const viewportWidth = window.innerWidth;

                                      // Calculate position
                                      let left = eventRect.left + (eventRect.width / 2) - (tooltipWidth / 2);

                                      // Adjust if too close to edges
                                      if (left < 10) {
                                        left = 10;
                                      } else if (left + tooltipWidth > viewportWidth - 10) {
                                        left = viewportWidth - tooltipWidth - 10;
                                      }

                                      tooltip.style.left = left + 'px';
                                      tooltip.style.top = (eventRect.top - tooltip.offsetHeight - 8) + 'px';
                                    }}
                                  >
                                    {/* Event Title */}
                                    <div className="font-normal text-gray-900 mb-1">{event.summary}</div>

                                    {/* Time */}
                                    <div className="text-gray-600 mb-1">
                                      {getEventTime(event)}
                                    </div>

                                    {/* Description - only if short */}
                                    {event.description && event.description.length < 200 && (
                                      <div className="text-gray-600 mb-1 leading-relaxed">
                                        {event.description}
                                      </div>
                                    )}

                                    {/* Location */}
                                    {event.location && (
                                      <div className="text-gray-600 mb-1">
                                        {event.location}
                                      </div>
                                    )}

                                    {/* Attendees - simplified */}
                                    {event.attendees && event.attendees.length > 0 && (
                                      <div className="text-gray-600 mb-1">
                                        {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
                                      </div>
                                    )}

                                    {/* Reminders - simplified */}
                                    {event.reminders && event.reminders.overrides && event.reminders.overrides.length > 0 && (
                                      <div className="text-gray-600">
                                        {event.reminders.overrides[0].minutes} min reminder
                                      </div>
                                    )}

                                    {/* Arrow */}
                                    <div
                                      className="absolute w-0 h-0 border-l-3 border-r-3 border-t-3 border-transparent border-t-white"
                                      style={{
                                        bottom: '-3px',
                                        left: '50%',
                                        transform: 'translateX(-50%)'
                                      }}
                                    ></div>
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
                <div className="flex flex-col items-center justify-center h-full p-2">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-50 to-purple-50 rounded-full flex items-center justify-center mb-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                  </div>
                  <h3 className="text-xs font-normal text-gray-700 mb-0.5">Clear Schedule</h3>
                  <p className="text-xs text-gray-500 text-center max-w-xs">
                    {sessionId ? "No upcoming events found. Enjoy your free time!" : "Connect your Google Calendar to see events"}
                  </p>
                </div>
              );
            }
          })()}
        </div>

        {/* Pomodoro timer only shows in notification overlay - no main page timer */}

        {/* AI Chat Section */}
        {isChatVisible && (
          <div className="card flex-[1] flex flex-col bg-white rounded-xl shadow-sm min-h-0">
            <div className="flex items-center justify-between p-1 flex-shrink-0">
              <div className="flex-1"></div>
              <div className="flex-1 flex justify-end">
                <button
                  onClick={() => setIsChatVisible(false)}
                  className="p-1 text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  title="Hide Chat"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-1 space-y-1 min-h-0">
              {chatMessages.length === 0 ? (
                <div className="flex justify-center items-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MessageCircle className="h-6 w-6 text-gray-600" />
                    </div>
                    <p className="text-sm font-normal text-gray-800 mb-2">Hi there! 👋</p>
                    <p className="text-sm text-gray-600 leading-relaxed">I'm your friendly personal assistant.<br />Just tell me what you'd like to schedule!</p>
                  </div>
                </div>
              ) : (
                chatMessages.map((message, index) => (
                  <div
                    key={message.id}
                    data-message-index={index}
                    className={`flex flex-col ${message.type === 'user' ? 'items-end' : 'items-start'} mb-4`}
                  >
                    <div
                      className={`max-w-[80%] ${message.type === 'user' ? 'bg-gray-200 text-gray-800 rounded-2xl px-4 py-3 ml-auto' : message.isCompleted ? 'bg-green-50 border border-green-200 rounded-2xl px-4 py-3' : message.requiresConfirmation ? 'bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3' : 'bg-white border border-gray-100 rounded-2xl px-4 py-3'}`}
                    >

                      {/* Status indicator */}
                      {message.type === 'ai' && (message.isCompleted || message.requiresConfirmation) && (
                        <div className="flex items-center space-x-2 mb-2">
                          {message.isCompleted && (
                            <div className="flex items-center space-x-1 text-green-600">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span className="text-xs">Completed</span>
                            </div>
                          )}
                          {message.requiresConfirmation && (
                            <div className="flex items-center space-x-1 text-yellow-600">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              <span className="text-xs">Confirmation Required</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-sm leading-normal text-gray-800 prose prose-sm max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            h1: ({ children }) => <h1 className="text-lg font-normal mb-2">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-normal mb-2">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-normal mb-1">{children}</h3>,
                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                            li: ({ children }) => <li className="text-sm">{children}</li>,
                            code: ({ children, className }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                              ) : (
                                <code className="block bg-gray-100 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>
                              );
                            },
                            pre: ({ children }) => <pre className="bg-gray-100 p-2 rounded text-xs font-mono overflow-x-auto mb-2">{children}</pre>,
                            blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-600 mb-2">{children}</blockquote>,
                            strong: ({ children }) => <strong className="font-normal">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            a: ({ children, href }) => <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                            table: ({ children }) => <div className="overflow-x-auto mb-2"><table className="min-w-full border border-gray-200">{children}</table></div>,
                            th: ({ children }) => <th className="border border-gray-200 px-2 py-1 text-left bg-gray-50 font-normal text-xs">{children}</th>,
                            td: ({ children }) => <td className="border border-gray-200 px-2 py-1 text-xs">{children}</td>,
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>

                      {/* AI Message Interaction Icons */}
                      {message.type === 'ai' && (
                        <div className="flex items-center space-x-2 mt-3 pt-2">
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Copy">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Like">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                            </svg>
                          </button>
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Dislike">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2" />
                            </svg>
                          </button>
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Speak">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                          </button>
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Edit">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Share">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                            </svg>
                          </button>
                          <button className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors" title="Regenerate">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        </div>
                      )}

                      {/* Overlap handling buttons */}
                      {message.hasOverlaps && message.overlapEvents && (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs text-gray-500 mb-2">How would you like to handle this conflict?</div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleOverlapChoice('reschedule', message.overlapEvents, message.overlaps)}
                              className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors font-normal"
                            >
                              Reschedule
                            </button>
                            <button
                              onClick={() => handleOverlapChoice('cancel_conflicting', message.overlapEvents, message.overlaps)}
                              className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors font-normal"
                            >
                              Cancel Conflicting
                            </button>
                            <button
                              onClick={() => handleOverlapChoice('create_anyway', message.overlapEvents, message.overlaps)}
                              className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors font-normal"
                            >
                              Create Anyway
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Tool confirmation buttons */}
                      {(() => {
                        const shouldShowConfirmation = message.requiresConfirmation && message.tools;
                        console.log('🔍 [DASHBOARD] Checking confirmation UI:', {
                          messageId: message.id,
                          requiresConfirmation: message.requiresConfirmation,
                          hasTools: !!message.tools,
                          shouldShowConfirmation,
                          toolsCount: message.tools?.length || 0,
                          tools: message.tools?.map(t => t.tool)
                        });

                        return shouldShowConfirmation ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs text-gray-500 mb-2">
                              Please confirm these operations:
                              <div className="mt-1">
                                {message.tools.map((tool, idx) => (
                                  <div key={idx} className="text-xs text-gray-600">
                                    • {tool.tool === 'delete_event' ? `Delete "${tool.parameters.eventTitle}"` : tool.tool}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => handleConfirmActions(message.tools, message.id)}
                                className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs hover:bg-red-200 transition-colors font-normal"
                              >
                                ✅ Confirm All
                              </button>
                              <button
                                onClick={() => handleCancelActions(message.tools, message.id)}
                                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 transition-colors font-normal"
                              >
                                ❌ Cancel
                              </button>
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>

                    {/* Tool indicator - separate bubble below message */}
                    {message.type === 'ai' && message.tools && message.tools.length > 0 && (
                      <div className="mt-2 max-w-[80%]">
                        <div className={`px-4 py-3 rounded-2xl border transition-colors ${message.isProcessing
                          ? 'bg-white border border-gray-100'
                          : 'bg-green-50 border border-green-200'
                          }`}>
                          <div className="flex items-center space-x-2">
                            {message.isProcessing ? (
                              <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            <span className={`text-xs ${message.isProcessing ? 'text-gray-600' : 'text-green-600'
                              }`}>
                              {message.tools.map((tool, idx) => (
                                <span key={idx}>
                                  {tool.name === 'create_event' && (message.isProcessing ? 'Creating event...' : 'Event created')}
                                  {tool.name === 'query_events' && (message.isProcessing ? 'Querying calendar...' : 'Calendar queried')}
                                  {tool.name === 'update_event' && (message.isProcessing ? 'Updating event...' : 'Event updated')}
                                  {tool.name === 'delete_event' && (message.isProcessing ? 'Deleting event...' : 'Event deleted')}
                                  {idx < message.tools.length - 1 && ', '}
                                </span>
                              ))}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 px-4 py-3 rounded-lg max-w-[80%]">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="p-1 flex-shrink-0">
              <form onSubmit={handleSendMessage} className="space-y-2">
                {/* Main input box */}
                <div className="relative">
                  <textarea
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (inputMessage.trim() && !isTyping) {
                          handleSendMessage(e);
                        }
                      }
                    }}
                    className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-3 pr-12 resize-none text-sm outline-none min-h-[56px] overflow-hidden"
                    placeholder=""
                    disabled={isTyping}
                    rows="1"
                    style={{
                      height: 'auto',
                      minHeight: '56px'
                    }}
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.max(e.target.scrollHeight, 56) + 'px';
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || isTyping}
                    className="absolute right-3 w-8 h-8 bg-black text-white rounded-full hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                    style={{
                      height: '36px',
                      width: '36px',
                      top: '50%',
                      transform: 'translateY(-50%)'
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>

                {/* Icons below the input */}
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      className="p-1 text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                      title="Add attachment"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                    <div className="relative" ref={toolsRef}>
                      <button
                        type="button"
                        className="flex items-center space-x-1 text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors px-1 py-1"
                        title="Tools"
                        onClick={() => setToolsOpen((open) => !open)}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-sm">Tools</span>
                        <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {toolsOpen && (
                        <div className="absolute left-0 bottom-10 mb-2 w-48 bg-white rounded-xl shadow-xl z-50 py-1 animate-fade-in border border-gray-100" style={{ bottom: '100%' }}>
                          <div className="flex flex-col divide-y divide-gray-100">
                            <button
                              type="button"
                              className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-800 transition-colors rounded-none text-left"
                              onClick={() => { handleClearChatHistory(); setToolsOpen(false); }}
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>Clear History</span>
                            </button>
                            {/* Example for future tools:
                            <button
                              type="button"
                              className="flex items-center gap-3 px-5 py-3 text-base text-gray-700 hover:bg-gray-50 transition-colors rounded-none text-left"
                              onClick={() => {}}
                            >
                              <SomeIcon className="w-5 h-5" />
                              <span>Some Tool</span>
                            </button>
                            */}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="p-1 text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                    title="Voice input"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Pomodoro timer only shows in notification overlay - no main page timer */}

      {/* Pomodoro Focus Overlay - Full Screen */}
      {pomodoroState !== 'idle' && isRunning && (
        <div className="fixed top-0 left-0 w-full h-full bg-white z-50 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-6">
            {/* Timer Display - Clean and Minimal */}
            <div className={`text-7xl font-light tracking-wide mb-6 ${pomodoroState === 'work' ? 'text-gray-900' : 'text-green-600'}`}>
              {formatTime(timeLeft)}
            </div>

            {/* Session Type - Clean Typography */}
            <div className="text-base font-normal text-gray-600 mb-8 tracking-wide">
              {pomodoroState === 'work' ? 'Focus Session' : 'Break Time'}
            </div>

            {/* Clean Controls */}
            <div className="flex justify-center space-x-4 mb-8">
              {!isRunning ? (
                <button
                  onClick={resumePomodoro}
                  className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors duration-200 font-normal text-sm flex items-center space-x-2"
                >
                  <Play className="h-4 w-4" />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  onClick={pausePomodoro}
                  className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors duration-200 font-normal text-sm flex items-center space-x-2"
                >
                  <Pause className="h-4 w-4" />
                  <span>Pause</span>
                </button>
              )}
              <button
                onClick={resetPomodoro}
                className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors duration-200 font-normal text-sm flex items-center space-x-2"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Stop</span>
              </button>
            </div>

            {/* Clean Progress Indicator */}
            <div className="w-48 h-1 bg-gray-200 mx-auto rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${pomodoroState === 'work' ? 'bg-gray-900' : 'bg-green-500'}`}
                style={{
                  width: `${((workDuration * 60 - timeLeft) / (workDuration * 60)) * 100}%`
                }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Pomodoro Notification Overlay */}
      {showPomodoroNotification && pomodoroNotificationData && (() => {
        const userLang = detectUserLanguage();
        const texts = getPomodoroTexts(userLang);

        return (
          <div className="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 shadow-xl max-w-sm w-full text-center">
              {/* Clean Timer Icon */}
              <div className="text-3xl mb-4">⏱️</div>

              {/* Show Timer if Pomodoro is running */}
              {pomodoroState !== 'idle' && isRunning ? (
                <>
                  <div className={`text-2xl font-light mb-3 ${pomodoroState === 'work' ? 'text-gray-900' : 'text-green-600'}`}>
                    {formatTime(timeLeft)}
                  </div>
                  <div className="text-sm text-gray-600 mb-4">
                    {pomodoroState === 'work' ? `${workDuration}min Focus Time` : `${breakDuration}min Break Time`}
                  </div>

                  {/* Clean Timer Controls */}
                  <div className="flex justify-center space-x-3 mb-4">
                    <button
                      onClick={pausePomodoro}
                      className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-normal flex items-center space-x-2"
                    >
                      <Pause className="h-3 w-3" />
                      <span>Pause</span>
                    </button>
                    <button
                      onClick={resetPomodoro}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-normal flex items-center space-x-2"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Stop</span>
                    </button>
                  </div>

                  <div className="text-xs text-gray-500">
                    {pomodoroState === 'work' ? 'Stay focused! You can do this!' : 'Take a well-deserved break!'}
                  </div>
                </>
              ) : (
                <>
                  {/* Clean Main Message */}
                  <div className="text-sm font-normal text-gray-800 mb-4 leading-relaxed">
                    {pomodoroNotificationData.message}
                  </div>

                  {/* Clean Focus & Preparation */}
                  {(pomodoroNotificationData.focus || pomodoroNotificationData.preparation) && (
                    <div className="text-xs text-gray-600 mb-4 space-y-2">
                      {pomodoroNotificationData.focus && (
                        <div className="flex items-center justify-center space-x-2">
                          <span className="text-gray-400">•</span>
                          <span>{pomodoroNotificationData.focus}</span>
                        </div>
                      )}
                      {pomodoroNotificationData.preparation && (
                        <div className="flex items-center justify-center space-x-2">
                          <span className="text-gray-400">•</span>
                          <span>{pomodoroNotificationData.preparation}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clean Session Info */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <div className="flex justify-center items-center space-x-8 text-sm">
                      <div className="text-center">
                        <div className="text-xl font-normal text-gray-900">{pomodoroNotificationData.workDuration}</div>
                        <div className="text-gray-500 text-xs">min work</div>
                      </div>
                      <div className="text-gray-300">+</div>
                      <div className="text-center">
                        <div className="text-xl font-normal text-gray-900">{pomodoroNotificationData.breakDuration}</div>
                        <div className="text-gray-500 text-xs">min break</div>
                      </div>
                    </div>
                  </div>

                  {/* Clean Action Buttons */}
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        startPomodoro();
                        setShowPomodoroNotification(false);
                        setPomodoroNotificationData(null);
                      }}
                      className="flex-1 px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-normal text-sm"
                    >
                      {texts.startButton}
                    </button>
                    <button
                      onClick={() => {
                        setShowPomodoroNotification(false);
                        setPomodoroNotificationData(null);
                      }}
                      className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-normal text-sm"
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