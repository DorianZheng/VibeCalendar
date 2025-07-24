// server/utils/session.js
const fs = require('fs').promises;
const path = require('path');

let sessions = null;
let saveSessions = null;
let SESSIONS_FILE = null;

function initializeSessionHandling(sessionsMap, saveSessionsFn, sessionsFilePath) {
    sessions = sessionsMap;
    saveSessions = saveSessionsFn || saveSessionsInternal;
    SESSIONS_FILE = sessionsFilePath || path.join(__dirname, '../sessions.json');
    console.log('✅ [SERVER] Initialized session handling');
}

// Load sessions from file
async function loadSessions(sessionsMap, sessionsFilePath) {
    const filePath = sessionsFilePath || path.join(__dirname, '../sessions.json');
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const sessionsData = JSON.parse(data);
        let loaded = 0, skipped = 0;
        for (const [sessionId, sessionData] of Object.entries(sessionsData)) {
            if (sessionData.tokens && sessionData.tokens.expiry_date && sessionData.tokens.expiry_date > Date.now()) {
                sessionsMap.set(sessionId, sessionData);
                loaded++;
            } else {
                skipped++;
            }
        }
        console.log(`📁 [SERVER] Loaded ${loaded} valid sessions from storage${skipped ? `, skipped ${skipped} expired` : ''}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📁 [SERVER] No existing sessions file found, starting fresh');
        } else {
            console.error('❌ [SERVER] Error loading sessions:', error.message);
        }
    }
}

async function saveSessionsInternal() {
    try {
        const sessionsData = {};
        for (const [sessionId, sessionData] of sessions.entries()) {
            sessionsData[sessionId] = sessionData;
        }
        await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessionsData, null, 2));
        console.log(`💾 [SERVER] Saved ${sessions.size} sessions to storage`);
    } catch (error) {
        console.error('❌ [SERVER] Error saving sessions:', error.message);
    }
}

async function updateSessionModel(sessionId, newModel) {
    if (sessionId && sessions?.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (session.preferredModel !== newModel) {
            session.preferredModel = newModel;
            sessions.set(sessionId, session);
            await saveSessions?.();
            console.log(`💾 [SERVER] Updated session ${sessionId.substring(0, 8)}... preferred model to: ${newModel}`);
        }
    }
}

function getCurrentModel(sessionId = null) {
    if (sessionId && sessions?.has(sessionId)) {
        const session = sessions.get(sessionId);
        return session.preferredModel || 'gemini-2.5-pro';
    }
    return 'gemini-2.5-pro';
}

// Cleanup expired sessions
async function cleanupExpiredSessions(sessionsMap, saveSessionsFn) {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [sessionId, session] of sessionsMap.entries()) {
        if (session.tokens.expiry_date && session.tokens.expiry_date < now) {
            sessionsMap.delete(sessionId);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        await saveSessionsFn();
        console.log(`🧹 [SERVER] Cleaned up ${cleanedCount} expired sessions`);
    }
}

// Helper to initialize sessions and session handling
async function initSessions(sessionsFilePath) {
    const sessionsMap = new Map();
    await loadSessions(sessionsMap, sessionsFilePath);
    initializeSessionHandling(sessionsMap, saveSessionsInternal, sessionsFilePath);
    return sessionsMap;
}

// Refresh token if needed
async function refreshTokenIfNeeded(sessionId, session, oauth2Client, saveSessionsFn) {
    try {
        if (session.tokens.expiry_date && session.tokens.expiry_date <= Date.now() + 5 * 60 * 1000) { // 5 minutes before expiry
            console.log('🔄 [SERVER] Refreshing token for session:', sessionId.substring(0, 8) + '...');
            oauth2Client.setCredentials(session.tokens);
            const { credentials } = await oauth2Client.refreshAccessToken();
            session.tokens = credentials;
            if (sessions && sessions.has(sessionId)) {
                sessions.set(sessionId, session);
            }
            if (saveSessionsFn) {
                await saveSessionsFn();
            }
            console.log('✅ [SERVER] Token refreshed for session:', sessionId.substring(0, 8) + '...');
        }
    } catch (error) {
        console.error('❌ [SERVER] Token refresh failed for session:', sessionId.substring(0, 8) + '...', error.message);
        // Remove the session if refresh fails
        if (sessions && sessions.has(sessionId)) {
            sessions.delete(sessionId);
        }
        if (saveSessionsFn) {
            await saveSessionsFn();
        }
    }
}

module.exports = {
    initializeSessionHandling,
    updateSessionModel,
    getCurrentModel,
    saveSessions: saveSessionsInternal,
    loadSessions,
    cleanupExpiredSessions,
    initSessions,
    refreshTokenIfNeeded
}; 