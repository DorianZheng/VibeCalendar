const requestLogger = (req, res, next) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  // Store request metadata for response logging
  req.requestId = requestId;
  req.startTime = startTime;
  
  // Override res.status to log errors
  const originalStatus = res.status;
  res.status = function(code) {
    if (code >= 400) {
      const responseTime = Date.now() - startTime;
      console.error(`❌ [SERVER] ERROR [${requestId}]:`, {
        requestId,
        method: req.method,
        url: req.url,
        status: code,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString()
      });
    }
    return originalStatus.call(this, code);
  };
  
  next();
};

module.exports = requestLogger; 