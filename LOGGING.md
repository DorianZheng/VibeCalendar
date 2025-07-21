# Comprehensive RPC Logging System

This document describes the comprehensive logging system implemented in VibeCalendar that logs all API calls (RPC calls) for debugging and monitoring purposes.

## Overview

The logging system provides detailed logging for:
- **Client-side API calls** (React frontend to Node.js backend)
- **Server-side API endpoints** (incoming requests and responses)
- **External API calls** (Google Calendar API, Gemini AI API)

## Log Categories

### 1. Client-Side RPC Logs (`🌐 [RPC]`)

**Location**: `client/src/utils/apiLogger.js`

**Features**:
- Automatic axios interceptors for all HTTP requests
- Unique request IDs for tracking
- Request/response timing
- Sanitized sensitive data
- User agent information

**Log Format**:
```
🌐 [RPC] REQUEST [1703123456789-1]: {
  requestId: "1703123456789-1",
  method: "POST",
  url: "http://localhost:50001/api/ai/schedule",
  data: { description: "..." },
  headers: { "x-session-id": "17528332..." },
  userAgent: "Mozilla/5.0...",
  timestamp: "2025-01-01T12:00:00.000Z"
}

✅ [RPC] RESPONSE [1703123456789-1]: {
  requestId: "1703123456789-1",
  responseTime: "245ms",
  status: 200,
  data: { success: true, ... },
  timestamp: "2025-01-01T12:00:00.245Z"
}
```

### 2. Server-Side API Logs (`🌐 [SERVER]`)

**Location**: `server/middleware/requestLogger.js`

**Features**:
- Middleware for all Express routes
- Request/response timing
- Sanitized headers and body data
- Error response logging
- IP address and user agent tracking

**Log Format**:
```
🌐 [SERVER] REQUEST [1703123456789-abc123]: {
  requestId: "1703123456789-abc123",
  method: "POST",
  url: "/api/ai/schedule",
  body: { description: "..." },
  headers: { "x-session-id": "17528332..." },
  ip: "::1",
  userAgent: "Mozilla/5.0...",
  timestamp: "2025-01-01T12:00:00.000Z"
}

✅ [SERVER] RESPONSE [1703123456789-abc123]: {
  requestId: "1703123456789-abc123",
  status: 200,
  responseTime: "245ms",
  data: { success: true, ... },
  timestamp: "2025-01-01T12:00:00.245Z"
}
```

### 3. External API Logs (`🌐 [EXTERNAL]`)

**Location**: `server/utils/externalApiLogger.js`

**Features**:
- Google Calendar API calls
- Gemini AI API calls
- Proxy configuration logging
- Response size tracking
- Detailed error information

**Log Format**:
```
🌐 [EXTERNAL] GEMINI REQUEST [EXT-1703123456789-1]: {
  requestId: "EXT-1703123456789-1",
  service: "GEMINI",
  method: "POST",
  url: "https://generativelanguage.googleapis.com/...",
  hasProxy: true,
  proxyConfig: "configured",
  timeout: 20000,
  timestamp: "2025-01-01T12:00:00.000Z"
}

✅ [EXTERNAL] GEMINI RESPONSE [EXT-1703123456789-1]: {
  requestId: "EXT-1703123456789-1",
  service: "GEMINI",
  status: 200,
  responseTime: "1234ms",
  responseSize: 2048,
  timestamp: "2025-01-01T12:00:00.123Z"
}
```

## Configuration

### Log Levels

The client-side logger supports different log levels:

```javascript
import { apiLogger } from './utils/apiLogger';

// Available levels: DEBUG, INFO, WARN, ERROR
apiLogger.setLogLevel('DEBUG'); // Most verbose
apiLogger.setLogLevel('INFO');  // Default
apiLogger.setLogLevel('WARN');  // Warnings and errors only
apiLogger.setLogLevel('ERROR'); // Errors only
```

### Environment Variables

```bash
# Set log level via environment variable
REACT_APP_LOG_LEVEL=DEBUG

# Enable/disable specific log categories
REACT_APP_ENABLE_RPC_LOGS=true
REACT_APP_ENABLE_SERVER_LOGS=true
REACT_APP_ENABLE_EXTERNAL_LOGS=true
```

## Data Sanitization

All logs automatically sanitize sensitive information:

### Client-Side Sanitization
- Session IDs: `17528332...` (first 8 characters)
- Authorization headers: `***AUTH***`
- Passwords, tokens, API keys: `***SENSITIVE***`

### Server-Side Sanitization
- Request bodies: Sensitive fields replaced
- Headers: Authorization, cookies, API keys hidden
- Response data: Tokens and secrets removed

### External API Sanitization
- API keys and tokens: `***SENSITIVE***`
- Authorization headers: Hidden
- Request/response bodies: Sensitive fields removed

## Usage Examples

### Manual Logging

```javascript
import { apiLogger } from './utils/apiLogger';

// Manual request logging
apiLogger.logRequest('/api/custom', { data: 'value' });

// Manual response logging
apiLogger.logResponse('/api/custom', { result: 'success' }, 150);

// Manual error logging
apiLogger.logError('/api/custom', error, { context: 'additional info' });
```

### External API Logging

```javascript
const { logManualExternalCall } = require('./utils/externalApiLogger');

// Log manual external API calls
const requestId = logManualExternalCall('GOOGLE_CALENDAR', 'list_events', {
  calendarId: 'primary',
  timeMin: '2025-01-01T00:00:00Z'
});
```

## Testing

Run the logging test script:

```bash
node test-logging.js
```

This will test all logging categories and show expected log patterns.

## Monitoring and Debugging

### Common Log Patterns

1. **Successful API Call**:
   ```
   🌐 [RPC] REQUEST [ID] → 🌐 [SERVER] REQUEST [ID] → ✅ [SERVER] RESPONSE [ID] → ✅ [RPC] RESPONSE [ID]
   ```

2. **AI Request with External API**:
   ```
   🌐 [RPC] REQUEST [ID] → 🌐 [SERVER] REQUEST [ID] → 🌐 [EXTERNAL] GEMINI REQUEST [ID] → ✅ [EXTERNAL] GEMINI RESPONSE [ID] → ✅ [SERVER] RESPONSE [ID] → ✅ [RPC] RESPONSE [ID]
   ```

3. **Error Case**:
   ```
   🌐 [RPC] REQUEST [ID] → 🌐 [SERVER] REQUEST [ID] → ❌ [SERVER] ERROR RESPONSE [ID] → ❌ [RPC] RESPONSE ERROR [ID]
   ```

### Performance Monitoring

- **Response Times**: All logs include timing information
- **Request Tracking**: Unique IDs allow end-to-end request tracing
- **Error Rates**: Error logs help identify problematic endpoints
- **External API Health**: Monitor external service availability

### Debugging Tips

1. **Find Related Logs**: Use request IDs to trace requests across all log categories
2. **Performance Issues**: Look for high response times in logs
3. **Authentication Problems**: Check for 401/403 errors in server logs
4. **External API Issues**: Monitor external API response times and error rates
5. **Rate Limiting**: Look for 429 errors in external API logs

## File Structure

```
├── client/src/utils/apiLogger.js          # Client-side logging
├── server/middleware/requestLogger.js      # Server-side logging
├── server/utils/externalApiLogger.js       # External API logging
├── test-logging.js                         # Test script
└── LOGGING.md                              # This documentation
```

## Security Considerations

- All sensitive data is automatically sanitized
- No passwords, tokens, or API keys are logged
- Session IDs are truncated for privacy
- External API keys are never logged
- Headers containing sensitive information are masked

## Performance Impact

- Minimal performance impact due to efficient logging
- Logs are written asynchronously
- Sanitization is optimized for speed
- Log levels can be adjusted for production vs development 