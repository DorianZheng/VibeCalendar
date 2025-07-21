const axios = require('axios');

// Generate unique request IDs for external API calls
let externalRequestCounter = 0;
const generateExternalRequestId = () => {
  externalRequestCounter++;
  return `EXT-${Date.now()}-${externalRequestCounter}`;
};

// Log external API errors only
const logExternalError = (service, error, requestId, startTime) => {
  const responseTime = startTime ? Date.now() - startTime : null;
  
  console.error(`❌ [EXTERNAL] ${service.toUpperCase()} ERROR [${requestId}]:`, {
    requestId,
    service: service.toUpperCase(),
    error: error.message,
    code: error.code,
    status: error.response?.status,
    statusText: error.response?.statusText,
    responseTime: responseTime ? `${responseTime}ms` : 'unknown',
    url: error.config?.url,
    method: error.config?.method,
    timestamp: new Date().toISOString()
  });
};

// Create a wrapped axios instance for external API calls
const createLoggedAxios = (service) => {
  const instance = axios.create();
  
  // Request interceptor - only track metadata
  instance.interceptors.request.use(
    (config) => {
      const requestId = generateExternalRequestId();
      const startTime = Date.now();
      
      config.metadata = { requestId, startTime, service };
      
      return config;
    },
    (error) => {
      logExternalError(service, error, 'UNKNOWN', null);
      return Promise.reject(error);
    }
  );
  
  // Response interceptor - only log errors
  instance.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      const { config } = error;
      const { requestId, startTime } = config?.metadata || {};
      
      logExternalError(service, error, requestId, startTime);
      return Promise.reject(error);
    }
  );
  
  return instance;
};

module.exports = {
  logExternalError,
  createLoggedAxios,
  generateExternalRequestId
}; 