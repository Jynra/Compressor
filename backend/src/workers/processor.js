// backend/src/workers/processor.js
require('dotenv').config();

const { processingQueue } = require('../services/queueService');
const ProcessingService = require('../services/processingService');
const JobService = require('../services/jobService');
const FileService = require('../services/fileService');
const logger = require('../utils/logger');
const { getRedisClient } = require('../utils/redis');

/**
 * Worker de traitement des fichiers multimédia
 */
class FileProcessor {
    constructor() {
        this.isShuttingDown = false;
        this.activeJobs = new Map();
        this.stats = {
            processed: 0,
            failed: 0,
            startTime: Date.now(),
            totalProcessingTime: 0
        };
    }

    /**
     * Initialiser le worker
     */
    async init() {
        try {
            logger.info('🔧 Initialisation du worker de traitement');

            // Vérifier les prérequis
            await this.checkPrerequisites();

            // Configuration du worker
            this.setupWorker();

            // Gestion gracieuse de l'arrêt
            this.setupGracefulShutdown();

            // Monitoring périodique
            this.setupMonitoring();

            logger.info('✅ Worker de traitement initialisé');
        } catch (error) {
            logger.error('❌ Erreur initialisation worker:', error);
            throw error;
        }
    }

    /**
     * Vérifier les prérequis
     */
    async checkPrerequisites() {
        try {
            // Vérifier Redis
            const redis = await getRedisClient();
            await redis.ping();
            logger.info('✅ Redis connecté');

            // Vérifier Sharp
            const sharp = require('sharp');
            logger.info(`✅ Sharp v${sharp.versions.sharp} disponible`);

            // Vérifier les répertoires
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            await FileService.ensureDirectoryExists(tempDir);
            await FileService.ensureDirectoryExists(`${tempDir}/output`);
            logger.info('✅ Répertoires vérifiés');

        } catch (error) {
            throw new Error(`Prérequis worker non satisfaits: ${error.message}`);
        }
    }

    /**
     * Configuration du worker Bull
     */
    setupWorker() {
        logger.info('⚙️ Configuration du worker Bull...');

        const concurrency = parseInt(process.env.WORKER_CONCURRENCY) || 2;
        const jobTimeout = parseInt(process.env.JOB_TIMEOUT) || 1800; // 30 minutes

        // Configuration du processeur principal
        processingQueue.process('optimize-file', concurrency, async (job) => {
            return await this.processJob(job);
        });

        // Événements du worker
        processingQueue.on('active', (job) => {
            const jobData = job.data.jobData;
            this.activeJobs.set(job.id, {
                jobId: jobData.id,
                startTime: Date.now(),
                fileName: jobData.originalName,
                type: jobData.type
            });

            logger.processing(`Job démarré: ${jobData.id} (${jobData.originalName})`);
        });

        processingQueue.on('completed', (job, result) => {
            const activeJob = this.activeJobs.get(job.id);
            if (activeJob) {
                const processingTime = Date.now() - activeJob.startTime;
                this.stats.processed++;
                this.stats.totalProcessingTime += processingTime;
                
                logger.processing(`Job terminé: ${result.jobId} en ${processingTime}ms`);
                this.activeJobs.delete(job.id);
            }
        });

        processingQueue.on('failed', (job, error) => {
            const activeJob = this.activeJobs.get(job.id);
            if (activeJob) {
                this.stats.failed++;
                logger.error(`Job échoué: ${activeJob.jobId}`, error);
                this.activeJobs.delete(job.id);
            }
        });

        processingQueue.on('stalled', (job) => {
            const jobData = job.data.jobData;
            logger.warn(`Job bloqué: ${jobData.id} (${jobData.originalName})`);
        });

        processingQueue.on('progress', (job, progress) => {
            const jobData = job.data.jobData;
            logger.debug(`Progression ${jobData.id}: ${progress}%`);
        });

        logger.info(`✅ Worker configuré (concurrence: ${concurrency}, timeout: ${jobTimeout}s)`);
    }

    /**
     * Traiter un job
     */
    async processJob(bullJob) {
        const { jobData } = bullJob.data;
        const startTime = Date.now();
        
        const jobLogger = logger.withContext({
            jobId: jobData.id,
            worker: 'processor',
            fileName: jobData.originalName
        });

        try {
            jobLogger.info('🔄 Démarrage du traitement');

            // Validation préalable
            const validation = await ProcessingService.validateJob(jobData);
            if (!validation.isValid) {
                throw new Error(`Validation échouée: ${validation.errors.join(', ')}`);
            }

            // Callback de progression pour Bull et WebSocket
            const progressCallback = async (progress) => {
                // Mettre à jour Bull
                bullJob.progress(progress);
                
                // Mettre à jour Redis
                await JobService.updateJob(jobData.id, { progress });
                
                // Notifier via WebSocket (si serveur disponible)
                if (global.io) {
                    global.io.emitJobProgress(jobData.id, progress);
                }
                
                jobLogger.debug(`Progression: ${progress}%`);
            };

            // Traitement principal
            jobLogger.info('🚀 Début du traitement du fichier');
            const result = await ProcessingService.processFile(jobData, progressCallback);

            const processingTime = Date.now() - startTime;
            jobLogger.info(`✅ Traitement terminé en ${processingTime}ms`);

            // Notifier la completion via WebSocket
            if (global.io) {
                global.io.emitJobCompleted(jobData.id, {
                    status: 'completed',
                    ...result,
                    processingTime
                });
            }

            // Métriques
            this.recordMetrics(jobData, processingTime, result);

            return {
                jobId: jobData.id,
                success: true,
                ...result,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            jobLogger.error('❌ Erreur traitement:', error, { processingTime });

            // Mettre à jour le job en erreur
            await JobService.updateJob(jobData.id, {
                status: 'error',
                error: error.message,
                progress: 0
            });

            // Notifier l'erreur via WebSocket
            if (global.io) {
                global.io.emitJobError(jobData.id, error);
            }

            // Nettoyer les fichiers en cas d'erreur
            await this.cleanupJobFiles(jobData);

            throw error;
        }
    }

    /**
     * Nettoyer les fichiers d'un job en erreur
     */
    async cleanupJobFiles(jobData) {
        try {
            // Supprimer le fichier source si il existe
            if (jobData.filePath) {
                await FileService.deleteFile(jobData.filePath);
            }

            // Supprimer le fichier de sortie partiel si il existe
            const outputDir = `${process.env.TEMP_DIR || '/tmp/uploads'}/output`;
            const possibleOutputs = [
                `${outputDir}/${jobData.id}.jpg`,
                `${outputDir}/${jobData.id}.png`,
                `${outputDir}/${jobData.id}.webp`,
                `${outputDir}/${jobData.id}_processed.mp4`,
                `${outputDir}/${jobData.id}_processed.mp3`,
                `${outputDir}/${jobData.id}_processed.pdf`
            ];

            for (const file of possibleOutputs) {
                await FileService.deleteFile(file).catch(() => {}); // Ignore les erreurs
            }

            logger.debug(`Fichiers nettoyés pour job ${jobData.id}`);
        } catch (error) {
            logger.warn(`Erreur nettoyage fichiers job ${jobData.id}:`, error);
        }
    }

    /**
     * Enregistrer les métriques de traitement
     */
    recordMetrics(jobData, processingTime, result) {
        try {
            const metrics = {
                type: jobData.type,
                originalSize: jobData.size,
                compressedSize: result.compressedSize,
                compressionRatio: result.compressionRatio,
                processingTime,
                timestamp: new Date().toISOString()
            };

            // Log métrique
            logger.metric('file_processed', 1, 'count', metrics);
            logger.metric('processing_time', processingTime, 'ms', {
                type: jobData.type,
                size: jobData.size
            });

            if (result.compressionRatio > 0) {
                logger.metric('compression_ratio', result.compressionRatio, '%', {
                    type: jobData.type
                });
                logger.metric('bytes_saved', jobData.size - result.compressedSize, 'bytes', {
                    type: jobData.type
                });
            }

        } catch (error) {
            logger.warn('Erreur enregistrement métriques:', error);
        }
    }

    /**
     * Configuration de l'arrêt gracieux
     */
    setupGracefulShutdown() {
        logger.info('🛡️ Configuration arrêt gracieux worker...');

        const shutdown = async (signal) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            logger.info(`🛑 Arrêt gracieux worker démarré (${signal})`);

            try {
                // 1. Arrêter d'accepter de nouveaux jobs
                await processingQueue.pause();
                logger.info('Queue mise en pause');

                // 2. Attendre la fin des jobs en cours (max 5 minutes)
                const timeout = 5 * 60 * 1000; // 5 minutes
                const startTime = Date.now();

                while (this.activeJobs.size > 0 && (Date.now() - startTime) < timeout) {
                    logger.info(`Attente fin des jobs en cours (${this.activeJobs.size} restants)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (this.activeJobs.size > 0) {
                    logger.warn(`Timeout atteint, arrêt forcé (${this.activeJobs.size} jobs interrompus)`);
                }

                // 3. Fermer la queue
                await processingQueue.close();
                logger.info('Queue fermée');

                // 4. Afficher les statistiques finales
                this.logFinalStats();

                logger.info('✅ Arrêt gracieux worker terminé');
                process.exit(0);

            } catch (error) {
                logger.error('❌ Erreur arrêt gracieux worker:', error);
                process.exit(1);
            }
        };

        // Signaux d'arrêt
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Nodemon

        // Erreurs non gérées
        process.on('uncaughtException', (error) => {
            logger.error('Exception non gérée worker:', error);
            shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Rejection non gérée worker:', reason, { promise });
            shutdown('unhandledRejection');
        });

        logger.info('✅ Arrêt gracieux worker configuré');
    }

    /**
     * Configuration du monitoring périodique
     */
    setupMonitoring() {
        logger.info('📊 Configuration monitoring worker...');

        // Stats périodiques toutes les 5 minutes
        setInterval(() => {
            this.logWorkerStats();
        }, 5 * 60 * 1000);

        // Health check toutes les minutes
        setInterval(async () => {
            await this.healthCheck();
        }, 60 * 1000);

        logger.info('✅ Monitoring worker configuré');
    }

    /**
     * Afficher les statistiques du worker
     */
    logWorkerStats() {
        const uptime = Date.now() - this.stats.startTime;
        const avgProcessingTime = this.stats.processed > 0 
            ? Math.round(this.stats.totalProcessingTime / this.stats.processed)
            : 0;

        const memUsage = process.memoryUsage();

        logger.info('📊 Statistiques worker', {
            uptime: Math.round(uptime / 1000),
            uptimeFormatted: this.formatDuration(uptime),
            activeJobs: this.activeJobs.size,
            processed: this.stats.processed,
            failed: this.stats.failed,
            avgProcessingTime: `${avgProcessingTime}ms`,
            memory: {
                rss: FileService.formatFileSize(memUsage.rss),
                heapUsed: FileService.formatFileSize(memUsage.heapUsed),
                heapTotal: FileService.formatFileSize(memUsage.heapTotal)
            }
        });

        // Métriques détaillées des jobs actifs
        if (this.activeJobs.size > 0) {
            const activeJobsInfo = Array.from(this.activeJobs.values()).map(job => ({
                jobId: job.jobId,
                fileName: job.fileName,
                type: job.type,
                duration: Date.now() - job.startTime
            }));

            logger.info('🔄 Jobs actifs', { jobs: activeJobsInfo });
        }
    }

    /**
     * Health check du worker
     */
    async healthCheck() {
        try {
            // Vérifier Redis
            const redis = await getRedisClient();
            await redis.ping();

            // Vérifier l'espace disque
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            const dirStats = await FileService.getDirectorySize(tempDir);

            // Vérifier la mémoire
            const memUsage = process.memoryUsage();
            const memLimit = 1 * 1024 * 1024 * 1024; // 1GB limite
            
            if (memUsage.heapUsed > memLimit) {
                logger.warn('⚠️ Utilisation mémoire élevée', {
                    heapUsed: FileService.formatFileSize(memUsage.heapUsed),
                    limit: FileService.formatFileSize(memLimit)
                });
            }

            // Vérifier les jobs bloqués
            const now = Date.now();
            const maxJobDuration = 30 * 60 * 1000; // 30 minutes
            
            for (const [bullJobId, activeJob] of this.activeJobs) {
                if (now - activeJob.startTime > maxJobDuration) {
                    logger.warn('⚠️ Job potentiellement bloqué', {
                        jobId: activeJob.jobId,
                        duration: now - activeJob.startTime,
                        fileName: activeJob.fileName
                    });
                }
            }

        } catch (error) {
            logger.error('❌ Health check worker échoué:', error);
        }
    }

    /**
     * Afficher les statistiques finales
     */
    logFinalStats() {
        const uptime = Date.now() - this.stats.startTime;
        const successRate = this.stats.processed + this.stats.failed > 0
            ? Math.round((this.stats.processed / (this.stats.processed + this.stats.failed)) * 100)
            : 0;

        logger.info('📈 Statistiques finales worker', {
            uptime: this.formatDuration(uptime),
            processed: this.stats.processed,
            failed: this.stats.failed,
            successRate: `${successRate}%`,
            totalProcessingTime: this.formatDuration(this.stats.totalProcessingTime),
            avgProcessingTime: this.stats.processed > 0 
                ? Math.round(this.stats.totalProcessingTime / this.stats.processed)
                : 0
        });
    }

    /**
     * Formater une durée en millisecondes
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}j ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Obtenir les statistiques actuelles
     */
    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        
        return {
            uptime,
            uptimeFormatted: this.formatDuration(uptime),
            activeJobs: this.activeJobs.size,
            processed: this.stats.processed,
            failed: this.stats.failed,
            successRate: this.stats.processed + this.stats.failed > 0
                ? Math.round((this.stats.processed / (this.stats.processed + this.stats.failed)) * 100)
                : 100,
            avgProcessingTime: this.stats.processed > 0 
                ? Math.round(this.stats.totalProcessingTime / this.stats.processed)
                : 0,
            memory: process.memoryUsage()
        };
    }
}

/**
 * Fonction principale de démarrage du worker
 */
async function main() {
    try {
        logger.info('🎯 File Optimizer Worker v2.0.0');
        logger.info(`📍 Environnement: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🔧 Node.js: ${process.version}`);
        logger.info(`👷 PID: ${process.pid}`);

        const processor = new FileProcessor();
        await processor.init();

        // Exposer les stats du worker
        global.getWorkerStats = () => processor.getStats();

        logger.info('🎉 Worker de traitement démarré avec succès !');
        logger.info('⏳ En attente de jobs à traiter...');

    } catch (error) {
        logger.error('💥 Échec démarrage worker:', error);
        process.exit(1);
    }
}

// Démarrer le worker si ce fichier est exécuté directement
if (require.main === module) {
    main();
}

module.exports = { FileProcessor, main };