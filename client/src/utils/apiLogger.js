import axios from 'axios';

// Generate unique request IDs
let requestCounter = 0;
const generateRequestId = () => {
  requestCounter++;
  return `${Date.now()}-${requestCounter}`;
};

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const currentLogLevel = LOG_LEVELS.ERROR; // Only log errors by default

const shouldLog = (level) => level >= currentLogLevel;

// Format error data for logging
const formatErrorData = (error) => {
  const { message, code, response, config } = error;
  
  return {
    message,
    code,
    status: response?.status,
    statusText: response?.statusText,
    url: config?.url,
    method: config?.method,
    timestamp: new Date().toISOString()
  };
};

// Request interceptor - only log errors
axios.interceptors.request.use(
  (config) => {
    const requestId = generateRequestId();
    config.metadata = { requestId, startTime: Date.now() };
    return config;
  },
  (error) => {
    if (shouldLog(LOG_LEVELS.ERROR)) {
      console.error('❌ [RPC] REQUEST ERROR:', {
        error: error.message,
        url: error.config?.url,
        method: error.config?.method,
        timestamp: new Date().toISOString()
      });
    }
    return Promise.reject(error);
  }
);

// Response interceptor - only log errors
axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const { config, response } = error;
    const { requestId } = config?.metadata || {};
    
    if (shouldLog(LOG_LEVELS.ERROR)) {
      const errorData = formatErrorData(error);
      console.error(`❌ [RPC] RESPONSE ERROR [${requestId}]:`, {
        requestId,
        ...errorData
      });
    }
    
    return Promise.reject(error);
  }
);

// Export logging utilities
export const apiLogger = {
  // Manual logging functions - only for errors
  logError: (endpoint, error, context = {}) => {
    if (shouldLog(LOG_LEVELS.ERROR)) {
      console.error(`❌ [RPC] ERROR:`, {
        endpoint,
        error: error.message,
        status: error.response?.status,
        context,
        timestamp: new Date().toISOString()
      });
    }
  },
  
  // Set log level
  setLogLevel: (level) => {
    if (LOG_LEVELS[level] !== undefined) {
      currentLogLevel = LOG_LEVELS[level];
    }
  },
  
  // Get current log level
  getLogLevel: () => {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel);
  },
  
  // Log levels
  LOG_LEVELS
};

export default apiLogger; 