const Logger = require('./logger');
const { getDatabase } = require('../database/database');

class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.timers = new Map();
        this.counters = new Map();
        this.db = getDatabase();
    }

    // Timer utilities
    startTimer(name, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        this.timers.set(key, {
            start: Date.now(),
            sessionId: sessionId
        });
    }

    endTimer(name, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        const timer = this.timers.get(key);
        
        if (timer) {
            const duration = Date.now() - timer.start;
            this.timers.delete(key);
            
            this.recordMetric(`${name}_duration`, duration, sessionId);
            Logger.performance(name, duration, sessionId);
            
            return duration;
        }
        
        return 0;
    }

    // Async function timer wrapper
    async timeAsync(name, asyncFn, sessionId = null) {
        this.startTimer(name, sessionId);
        try {
            const result = await asyncFn();
            this.endTimer(name, sessionId);
            return result;
        } catch (error) {
            this.endTimer(name, sessionId);
            this.incrementCounter(`${name}_errors`, sessionId);
            throw error;
        }
    }

    // Counter utilities
    incrementCounter(name, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        const current = this.counters.get(key) || 0;
        this.counters.set(key, current + 1);
        
        this.recordMetric(`${name}_count`, current + 1, sessionId);
    }

    decrementCounter(name, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        const current = this.counters.get(key) || 0;
        const newValue = Math.max(0, current - 1);
        this.counters.set(key, newValue);
        
        this.recordMetric(`${name}_count`, newValue, sessionId);
    }

    getCounter(name, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        return this.counters.get(key) || 0;
    }

    // Gauge utilities (current value metrics)
    setGauge(name, value, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        this.metrics.set(key, {
            value: value,
            timestamp: Date.now(),
            sessionId: sessionId
        });
        
        this.recordMetric(name, value, sessionId);
    }

    getGauge(name, sessionId = null) {
        const key = sessionId ? `${name}:${sessionId}` : name;
        const metric = this.metrics.get(key);
        return metric ? metric.value : null;
    }

    // Memory monitoring
    recordMemoryUsage() {
        const memUsage = process.memoryUsage();
        
        this.setGauge('memory_rss', memUsage.rss);
        this.setGauge('memory_heap_used', memUsage.heapUsed);
        this.setGauge('memory_heap_total', memUsage.heapTotal);
        this.setGauge('memory_external', memUsage.external);
        
        return memUsage;
    }

    // CPU monitoring
    recordCpuUsage() {
        const cpuUsage = process.cpuUsage();
        
        this.setGauge('cpu_user', cpuUsage.user);
        this.setGauge('cpu_system', cpuUsage.system);
        
        return cpuUsage;
    }

    // Session metrics
    recordSessionMetrics(sessions) {
        const statusCounts = {};
        let totalSessions = 0;
        let connectedSessions = 0;
        
        for (const session of sessions.values()) {
            totalSessions++;
            statusCounts[session.status] = (statusCounts[session.status] || 0) + 1;
            
            if (session.status === 'CONNECTED') {
                connectedSessions++;
            }
        }
        
        this.setGauge('sessions_total', totalSessions);
        this.setGauge('sessions_connected', connectedSessions);
        
        for (const [status, count] of Object.entries(statusCounts)) {
            this.setGauge(`sessions_${status.toLowerCase()}`, count);
        }
        
        return {
            total: totalSessions,
            connected: connectedSessions,
            byStatus: statusCounts
        };
    }

    // HTTP request metrics
    recordHttpRequest(method, path, statusCode, duration) {
        this.incrementCounter('http_requests_total');
        this.incrementCounter(`http_requests_${method.toLowerCase()}`);
        this.incrementCounter(`http_responses_${statusCode}`);
        this.recordMetric('http_request_duration', duration);
        
        if (statusCode >= 400) {
            this.incrementCounter('http_errors_total');
        }
    }

    // WhatsApp specific metrics
    recordWhatsAppMetric(event, sessionId, duration = null) {
        this.incrementCounter(`whatsapp_${event}`, sessionId);
        
        if (duration !== null) {
            this.recordMetric(`whatsapp_${event}_duration`, duration, sessionId);
        }
    }

    // Webhook metrics
    recordWebhookMetric(url, success, duration, sessionId = null) {
        this.incrementCounter('webhook_attempts', sessionId);
        
        if (success) {
            this.incrementCounter('webhook_success', sessionId);
        } else {
            this.incrementCounter('webhook_failures', sessionId);
        }
        
        this.recordMetric('webhook_duration', duration, sessionId);
    }

    // Generic metric recording
    async recordMetric(name, value, sessionId = null) {
        try {
            if (this.db.isConnected) {
                await this.db.recordMetric(name, value, sessionId);
            }
        } catch (error) {
            Logger.error('Failed to record metric to database', error);
        }
    }

    // Get performance summary
    getPerformanceSummary() {
        const memUsage = this.recordMemoryUsage();
        const cpuUsage = this.recordCpuUsage();
        
        return {
            memory: {
                rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            uptime: process.uptime(),
            counters: Object.fromEntries(this.counters),
            metrics: Object.fromEntries(
                Array.from(this.metrics.entries()).map(([key, value]) => [
                    key, 
                    { value: value.value, timestamp: value.timestamp }
                ])
            )
        };
    }

    // Health monitoring
    checkHealth() {
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
        const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
        const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;
        
        const health = {
            status: 'healthy',
            issues: []
        };
        
        // Memory health checks
        if (heapUsagePercent > 90) {
            health.status = 'critical';
            health.issues.push('High memory usage detected');
        } else if (heapUsagePercent > 70) {
            health.status = 'warning';
            health.issues.push('Elevated memory usage detected');
        }
        
        // Error rate checks
        const totalRequests = this.getCounter('http_requests_total');
        const totalErrors = this.getCounter('http_errors_total');
        
        if (totalRequests > 0) {
            const errorRate = (totalErrors / totalRequests) * 100;
            if (errorRate > 10) {
                health.status = 'critical';
                health.issues.push('High error rate detected');
            } else if (errorRate > 5) {
                health.status = 'warning';
                health.issues.push('Elevated error rate detected');
            }
        }
        
        return health;
    }

    // Reset all metrics (useful for testing)
    reset() {
        this.metrics.clear();
        this.timers.clear();
        this.counters.clear();
    }

    // Start background monitoring
    startBackgroundMonitoring(intervalMs = 60000) {
        setInterval(() => {
            this.recordMemoryUsage();
            this.recordCpuUsage();
            
            const health = this.checkHealth();
            if (health.status !== 'healthy') {
                Logger.warn(`Performance health check: ${health.status}`, null, { 
                    issues: health.issues 
                });
            }
        }, intervalMs);
        
        Logger.info(`Background performance monitoring started (interval: ${intervalMs}ms)`);
    }
}

// Singleton instance
let perfMonitor = null;

const getPerformanceMonitor = () => {
    if (!perfMonitor) {
        perfMonitor = new PerformanceMonitor();
    }
    return perfMonitor;
};

module.exports = { PerformanceMonitor, getPerformanceMonitor }; 