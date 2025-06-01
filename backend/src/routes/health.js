// backend/src/routes/health.js
const express = require('express');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

const { healthCheck: redisHealthCheck, getMetrics: getRedisMetrics } = require('../utils/redis');
const { getQueueStats } = require('../services/queueService');
const JobService = require('../services/jobService');
const FileService = require('../services/fileService');
const { validateRequest } = require('../utils/validation');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/health
 * Vérification de santé basique
 */
router.get('/', async (req, res) => {
    try {
        const startTime = Date.now();
        
        // Tests de base
        const checks = {
            server: await checkServer(),
            redis: await checkRedis(),
            filesystem: await checkFilesystem(),
            memory: await checkMemory()
        };

        // Déterminer le statut global
        const allHealthy = Object.values(checks).every(check => check.status === 'ok');
        const responseTime = Date.now() - startTime;

        const response = {
            status: allHealthy ? 'ok' : 'error',
            timestamp: new Date().toISOString(),
            responseTime: `${responseTime}ms`,
            checks,
            version: process.env.npm_package_version || '2.0.0',
            uptime: Math.floor(process.uptime()),
            environment: process.env.NODE_ENV || 'development'
        };

        // Log si problème détecté
        if (!allHealthy) {
            logger.warn('Health check failed', { checks, responseTime });
        }

        res.status(allHealthy ? 200 : 503).json(response);

    } catch (error) {
        logger.error('Erreur health check:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Health check failed',
            message: error.message
        });
    }
});

/**
 * GET /api/health/detailed
 * Vérification de santé détaillée
 */
router.get('/detailed',
    validateRequest.healthCheck,
    async (req, res) => {
        try {
            const { includeMetrics, includeRedis, includeQueue } = req.query;
            const startTime = Date.now();

            // Tests détaillés
            const checks = {
                server: await checkServerDetailed(),
                redis: includeRedis ? await checkRedisDetailed() : await checkRedis(),
                filesystem: await checkFilesystemDetailed(),
                memory: await checkMemoryDetailed(),
                queue: includeQueue ? await checkQueue() : null,
                dependencies: await checkDependencies()
            };

            // Métriques optionnelles
            let metrics = null;
            if (includeMetrics) {
                metrics = await collectMetrics();
            }

            // Supprimer les checks null
            Object.keys(checks).forEach(key => {
                if (checks[key] === null) delete checks[key];
            });

            const allHealthy = Object.values(checks).every(check => check.status === 'ok');
            const responseTime = Date.now() - startTime;

            const response = {
                status: allHealthy ? 'ok' : 'error',
                timestamp: new Date().toISOString(),
                responseTime: `${responseTime}ms`,
                checks,
                system: {
                    platform: os.platform(),
                    arch: os.arch(),
                    nodeVersion: process.version,
                    uptime: Math.floor(process.uptime()),
                    pid: process.pid
                }
            };

            if (metrics) {
                response.metrics = metrics;
            }

            res.status(allHealthy ? 200 : 503).json(response);

        } catch (error) {
            logger.error('Erreur health check détaillé:', error);
            res.status(503).json({
                status: 'error',
                timestamp: new Date().toISOString(),
                error: 'Detailed health check failed',
                message: error.message
            });
        }
    }
);

/**
 * GET /api/health/readiness
 * Vérification de disponibilité (pour Kubernetes)
 */
router.get('/readiness', async (req, res) => {
    try {
        const checks = {
            redis: await checkRedis(),
            filesystem: await checkFilesystem()
        };

        const isReady = Object.values(checks).every(check => check.status === 'ok');

        res.status(isReady ? 200 : 503).json({
            status: isReady ? 'ready' : 'not ready',
            timestamp: new Date().toISOString(),
            checks
        });

    } catch (error) {
        res.status(503).json({
            status: 'not ready',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

/**
 * GET /api/health/liveness
 * Vérification de vivacité (pour Kubernetes)
 */
router.get('/liveness', (req, res) => {
    // Test simple : le serveur répond
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime())
    });
});

/**
 * Vérifications de santé individuelles
 */

async function checkServer() {
    try {
        return {
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            pid: process.pid,
            nodeVersion: process.version
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkServerDetailed() {
    try {
        const loadAvg = os.loadavg();
        const cpuCount = os.cpus().length;
        
        return {
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            pid: process.pid,
            nodeVersion: process.version,
            platform: os.platform(),
            arch: os.arch(),
            cpuCount,
            loadAverage: {
                '1min': loadAvg[0].toFixed(2),
                '5min': loadAvg[1].toFixed(2),
                '15min': loadAvg[2].toFixed(2)
            },
            hostname: os.hostname()
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkRedis() {
    try {
        const health = await redisHealthCheck();
        return health;
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkRedisDetailed() {
    try {
        const health = await redisHealthCheck();
        
        if (health.status === 'ok') {
            const metrics = await getRedisMetrics();
            return {
                ...health,
                metrics
            };
        }
        
        return health;
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkFilesystem() {
    try {
        const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
        
        // Tester l'écriture
        const testFile = path.join(tempDir, `health-check-${Date.now()}.tmp`);
        await fs.writeFile(testFile, 'health check');
        await fs.unlink(testFile);
        
        return {
            status: 'ok',
            tempDir,
            writable: true
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message,
            writable: false
        };
    }
}

async function checkFilesystemDetailed() {
    try {
        const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
        
        // Tester l'écriture
        const testFile = path.join(tempDir, `health-check-${Date.now()}.tmp`);
        const testData = 'health check test data';
        
        const writeStart = Date.now();
        await fs.writeFile(testFile, testData);
        const writeTime = Date.now() - writeStart;
        
        const readStart = Date.now();
        const readData = await fs.readFile(testFile, 'utf8');
        const readTime = Date.now() - readStart;
        
        await fs.unlink(testFile);
        
        // Obtenir l'usage disque
        const dirStats = await FileService.getDirectorySize(tempDir);
        
        return {
            status: 'ok',
            tempDir,
            writable: true,
            readable: true,
            writeTime: `${writeTime}ms`,
            readTime: `${readTime}ms`,
            dataIntegrity: readData === testData,
            diskUsage: {
                files: dirStats.fileCount,
                size: dirStats.size,
                sizeFormatted: dirStats.sizeFormatted
            }
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message,
            writable: false
        };
    }
}

async function checkMemory() {
    try {
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        // Seuils d'alerte (configurable)
        const memoryThreshold = 0.9; // 90%
        const heapThreshold = 0.8; // 80%
        
        const memoryUsagePercent = usedMem / totalMem;
        const heapUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
        
        let status = 'ok';
        const warnings = [];
        
        if (memoryUsagePercent > memoryThreshold) {
            status = 'warning';
            warnings.push('High system memory usage');
        }
        
        if (heapUsagePercent > heapThreshold) {
            status = 'warning';
            warnings.push('High heap usage');
        }
        
        return {
            status,
            warnings: warnings.length > 0 ? warnings : undefined,
            system: {
                total: FileService.formatFileSize(totalMem),
                free: FileService.formatFileSize(freeMem),
                used: FileService.formatFileSize(usedMem),
                usagePercent: Math.round(memoryUsagePercent * 100)
            }
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkMemoryDetailed() {
    try {
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        const memoryUsagePercent = usedMem / totalMem;
        const heapUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
        
        let status = 'ok';
        const warnings = [];
        
        if (memoryUsagePercent > 0.9) {
            status = 'warning';
            warnings.push('High system memory usage');
        }
        
        if (heapUsagePercent > 0.8) {
            status = 'warning';
            warnings.push('High heap usage');
        }
        
        return {
            status,
            warnings: warnings.length > 0 ? warnings : undefined,
            system: {
                total: FileService.formatFileSize(totalMem),
                free: FileService.formatFileSize(freeMem),
                used: FileService.formatFileSize(usedMem),
                usagePercent: Math.round(memoryUsagePercent * 100)
            },
            process: {
                heapTotal: FileService.formatFileSize(memUsage.heapTotal),
                heapUsed: FileService.formatFileSize(memUsage.heapUsed),
                heapUsagePercent: Math.round(heapUsagePercent * 100),
                external: FileService.formatFileSize(memUsage.external),
                arrayBuffers: FileService.formatFileSize(memUsage.arrayBuffers || 0),
                rss: FileService.formatFileSize(memUsage.rss)
            }
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkQueue() {
    try {
        const queueStats = await getQueueStats();
        
        if (!queueStats) {
            return {
                status: 'error',
                error: 'Unable to get queue stats'
            };
        }
        
        // Vérifier s'il y a trop de jobs en échec
        const failureRate = queueStats.total > 0 ? 
            (queueStats.failed / queueStats.total) * 100 : 0;
        
        let status = 'ok';
        const warnings = [];
        
        if (failureRate > 20) { // Plus de 20% d'échecs
            status = 'warning';
            warnings.push('High job failure rate');
        }
        
        if (queueStats.waiting > 100) { // Plus de 100 jobs en attente
            status = 'warning';
            warnings.push('High number of waiting jobs');
        }
        
        return {
            status,
            warnings: warnings.length > 0 ? warnings : undefined,
            stats: queueStats,
            failureRate: Math.round(failureRate)
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function checkDependencies() {
    try {
        const dependencies = {};
        
        // Vérifier Sharp
        try {
            const sharp = require('sharp');
            const sharpVersion = sharp.versions;
            dependencies.sharp = {
                status: 'ok',
                version: sharpVersion
            };
        } catch (error) {
            dependencies.sharp = {
                status: 'error',
                error: 'Sharp not available'
            };
        }
        
        // Vérifier FFmpeg (si configuré)
        const ffmpegPath = process.env.FFMPEG_PATH;
        if (ffmpegPath) {
            try {
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);
                
                const { stdout } = await execAsync(`${ffmpegPath} -version`);
                const versionMatch = stdout.match(/ffmpeg version ([^\s]+)/);
                
                dependencies.ffmpeg = {
                    status: 'ok',
                    path: ffmpegPath,
                    version: versionMatch ? versionMatch[1] : 'unknown'
                };
            } catch (error) {
                dependencies.ffmpeg = {
                    status: 'error',
                    path: ffmpegPath,
                    error: 'FFmpeg not available or invalid path'
                };
            }
        }
        
        // Déterminer le statut global
        const allOk = Object.values(dependencies).every(dep => dep.status === 'ok');
        
        return {
            status: allOk ? 'ok' : 'warning',
            dependencies
        };
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

async function collectMetrics() {
    try {
        // Métriques des jobs
        const jobStats = await JobService.getJobStats();
        
        // Métriques de la queue
        const queueStats = await getQueueStats();
        
        // Métriques système
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        // Métriques de performance récentes
        const recentJobs = await JobService.getAllJobs(100);
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const jobs24h = recentJobs.filter(job => 
            new Date(job.createdAt) >= last24h
        );
        
        const completedJobs24h = jobs24h.filter(job => job.status === 'completed');
        
        // Calculs de performance
        const totalProcessed24h = completedJobs24h.reduce((sum, job) => 
            sum + (parseInt(job.size) || 0), 0
        );
        
        const avgProcessingTime = completedJobs24h.length > 0 ?
            completedJobs24h.reduce((sum, job) => {
                const processingTime = new Date(job.updatedAt) - new Date(job.createdAt);
                return sum + processingTime;
            }, 0) / completedJobs24h.length : 0;
        
        return {
            jobs: jobStats,
            queue: queueStats,
            performance: {
                jobs24h: jobs24h.length,
                completed24h: completedJobs24h.length,
                totalProcessed24h,
                totalProcessed24hFormatted: FileService.formatFileSize(totalProcessed24h),
                avgProcessingTime: Math.round(avgProcessingTime / 1000), // en secondes
                throughput: Math.round(completedJobs24h.length / 24 * 100) / 100 // jobs/heure
            },
            system: {
                memory: {
                    heapUsed: memUsage.heapUsed,
                    heapTotal: memUsage.heapTotal,
                    external: memUsage.external,
                    rss: memUsage.rss
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system
                },
                uptime: process.uptime(),
                loadAverage: os.loadavg()
            }
        };
    } catch (error) {
        logger.error('Erreur collecte métriques:', error);
        return {
            error: 'Unable to collect metrics',
            message: error.message
        };
    }
}

/**
 * GET /api/health/metrics
 * Métriques système pour monitoring externe (Prometheus, etc.)
 */
router.get('/metrics', async (req, res) => {
    try {
        const metrics = await collectMetrics();
        
        // Format Prometheus (optionnel)
        if (req.get('Accept') === 'text/plain') {
            const prometheusMetrics = convertToPrometheusFormat(metrics);
            res.setHeader('Content-Type', 'text/plain; version=0.0.4');
            res.send(prometheusMetrics);
        } else {
            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                metrics
            });
        }
    } catch (error) {
        logger.error('Erreur métriques:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to collect metrics'
        });
    }
});

/**
 * Convertir les métriques au format Prometheus
 */
function convertToPrometheusFormat(metrics) {
    let output = '';
    
    // Métriques des jobs
    if (metrics.jobs) {
        output += `# HELP file_optimizer_jobs_total Total number of jobs by status\n`;
        output += `# TYPE file_optimizer_jobs_total counter\n`;
        Object.entries(metrics.jobs).forEach(([status, count]) => {
            if (typeof count === 'number') {
                output += `file_optimizer_jobs_total{status="${status}"} ${count}\n`;
            }
        });
    }
    
    // Métriques de performance
    if (metrics.performance) {
        output += `# HELP file_optimizer_throughput_jobs_per_hour Jobs processed per hour\n`;
        output += `# TYPE file_optimizer_throughput_jobs_per_hour gauge\n`;
        output += `file_optimizer_throughput_jobs_per_hour ${metrics.performance.throughput || 0}\n`;
        
        output += `# HELP file_optimizer_avg_processing_time_seconds Average processing time in seconds\n`;
        output += `# TYPE file_optimizer_avg_processing_time_seconds gauge\n`;
        output += `file_optimizer_avg_processing_time_seconds ${metrics.performance.avgProcessingTime || 0}\n`;
    }
    
    // Métriques système
    if (metrics.system && metrics.system.memory) {
        output += `# HELP process_resident_memory_bytes Resident memory size in bytes\n`;
        output += `# TYPE process_resident_memory_bytes gauge\n`;
        output += `process_resident_memory_bytes ${metrics.system.memory.rss}\n`;
        
        output += `# HELP nodejs_heap_size_used_bytes Process heap space used in bytes\n`;
        output += `# TYPE nodejs_heap_size_used_bytes gauge\n`;
        output += `nodejs_heap_size_used_bytes ${metrics.system.memory.heapUsed}\n`;
    }
    
    return output;
}

module.exports = router;