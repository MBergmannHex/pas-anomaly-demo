'use strict';
/**
 * Session Extraction - Proprietary alarm session algorithms
 * Concurrent unit tracking, session filtering, unit statistics
 */

const SESSION_FILTERS = {
    MIN_EVENTS: 4,
    MAX_EVENTS: 400,
    MAX_DURATION_HOURS: 2,
    SESSION_TIMEOUT_MINUTES: 5
};

function _finalizeSession(session, sessionsList) {
    const eventCount = session.events.length;

    if (eventCount >= SESSION_FILTERS.MIN_EVENTS &&
        eventCount <= SESSION_FILTERS.MAX_EVENTS) {

        session.units = Array.from(session.units);
        session.tags = Array.from(session.tags);
        session.duration = session.endTime - session.startTime;

        const durationMinutes = session.duration / (60 * 1000);
        session.alarmFrequency = durationMinutes > 0 ? (session.alarms / durationMinutes) * 10 : 0;

        session.tagDescriptions = Object.fromEntries(session.descriptions);
        delete session.descriptions; // not JSON-serializable (Map)

        sessionsList.push(session);
    }
}

/**
 * Extracts sessions from event data based on time window per UNIT.
 * Uses concurrent unit tracking: interleaved events across units don't
 * prematurely close each other's sessions.
 */
function extractSessions(data) {
    const sessions = [];
    const SESSION_TIMEOUT = SESSION_FILTERS.SESSION_TIMEOUT_MINUTES * 60 * 1000;
    const MAX_DURATION = SESSION_FILTERS.MAX_DURATION_HOURS * 60 * 60 * 1000;

    const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const activeSessions = {};

    for (let i = 0; i < sortedData.length; i++) {
        const event = sortedData[i];
        const unitKey = event.unit || 'Unknown';

        let unitSession = activeSessions[unitKey];

        if (unitSession) {
            const timeSinceLastEvent = event.timestamp - unitSession.endTime;
            const duration = event.timestamp - unitSession.startTime;

            if (timeSinceLastEvent > SESSION_TIMEOUT || duration > MAX_DURATION) {
                _finalizeSession(unitSession, sessions);
                delete activeSessions[unitKey];
                unitSession = null;
            }
        }

        if (!unitSession) {
            unitSession = {
                id: sessions.length + Object.keys(activeSessions).length,
                unit: unitKey,
                events: [],
                startTime: event.timestamp,
                endTime: event.timestamp,
                alarms: 0,
                actions: 0,
                units: new Set([unitKey]),
                tags: new Set(),
                descriptions: new Map(),
                eventDescriptions: []
            };
            activeSessions[unitKey] = unitSession;
        }

        unitSession.events.push(event);
        unitSession.endTime = event.timestamp;

        if (event.isAlarm) unitSession.alarms++;
        if (event.isChange) unitSession.actions++;
        unitSession.tags.add(event.tag);

        if (event.Desc1 || event.Desc2) {
            unitSession.descriptions.set(event.tag, {
                desc1: event.Desc1 || '',
                desc2: event.Desc2 || ''
            });
            unitSession.eventDescriptions.push({
                tag: event.tag,
                desc1: event.Desc1 || '',
                desc2: event.Desc2 || '',
                timestamp: event.timestamp,
                isAlarm: event.isAlarm
            });
        }
    }

    Object.values(activeSessions).forEach(session => {
        _finalizeSession(session, sessions);
    });

    sessions.sort((a, b) => a.startTime - b.startTime);
    sessions.forEach((session, index) => { session.id = index; });

    return sessions;
}

/**
 * Aggregates per-unit statistics from session array.
 */
function getUnitStatistics(sessions) {
    const unitStats = new Map();

    sessions.forEach(session => {
        const unit = session.unit;
        if (!unitStats.has(unit)) {
            unitStats.set(unit, {
                unit,
                sessionCount: 0,
                totalEvents: 0,
                totalAlarms: 0,
                totalActions: 0,
                avgSessionDuration: 0,
                avgAlarmFrequency: 0,
                totalDuration: 0
            });
        }

        const stats = unitStats.get(unit);
        stats.sessionCount++;
        stats.totalEvents += session.events.length;
        stats.totalAlarms += session.alarms;
        stats.totalActions += session.actions;
        stats.totalDuration += session.duration;
        stats.avgAlarmFrequency = (stats.avgAlarmFrequency * (stats.sessionCount - 1) + session.alarmFrequency) / stats.sessionCount;
    });

    unitStats.forEach(stats => {
        stats.avgSessionDuration = stats.sessionCount > 0 ? stats.totalDuration / stats.sessionCount : 0;
    });

    return Array.from(unitStats.values());
}

module.exports = { extractSessions, getUnitStatistics };
