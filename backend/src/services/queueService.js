// backend/src/services/queueService.js
const Queue = require('bull');
const logger = require('../utils/logger');

/**
 * Service de gestion de la queue de traitement
 */
class QueueService {
    constructor() {
        this.processingQueue = null;
        this.initialized = false;
    }

    /**
     * Initialiser la queue
     */
    init() {
        if (this.initialized) return;

        try {
            // Configuration de la queue Bull
            this.processingQueue = new Queue('file processing', {
                redis: {
                    port: process.env.REDIS_PORT || 6379,
                    host: process.env.REDIS_HOST || 'localhost',
                    password: process.env.REDIS_PASSWORD || undefined
                },
                defaultJobOptions: {
                    removeOnComplete: 10,   // Garder 10 jobs complétés
                    removeOnFail: 50,       // Garder 50 jobs échoués
                    attempts: 3,            // 3 tentatives max
                    backoff: {
                        type: 'exponential',
                        delay: 2000
                    }
                }
            });

            // Événements de la queue
            this.setupEventListeners();
            
            this.initialized = true;
            logger.info('Queue service initialisé');
        } catch (error) {
            logger.error('Erreur initialisation queue:', error);
            throw error;
        }
    }

    /**
     * Configurer les événements de la queue
     */
    setupEventListeners() {
        this.processingQueue.on('completed', (job, result) => {
            logger.info(`Job complété: ${result.jobId}`);
        });

        this.processingQueue.on('failed', (job, err) => {
            logger.error(`Job échoué: ${job.data.jobData.id}`, err);
        });

        this.processingQueue.on('stalled', (job) => {
            logger.warn(`Job bloqué: ${job.data.jobData.id}`);
        });

        this.processingQueue.on('progress', (job, progress) => {
            logger.debug(`Job progrès: ${job.data.jobData.id} - ${progress}%`);
        });

        this.processingQueue.on('active', (job) => {
            logger.info(`Job démarré: ${job.data.jobData.id}`);
        });
    }

    /**
     * Ajouter un job à la queue
     */
    async addJob(jobData, options = {}) {
        try {
            if (!this.initialized) {
                this.init();
            }

            const job = await this.processingQueue.add('optimize-file', 
                { jobData }, 
                {
                    priority: this.getJobPriority(jobData),
                    delay: options.delay || 0,
                    ...options
                }
            );
            
            logger.info(`Job ajouté à la queue: ${jobData.id} (Bull ID: ${job.id})`);
            return job;
        } catch (error) {
            logger.error('Erreur ajout job à la queue:', error);
            throw error;
        }
    }

    /**
     * Calculer la priorité d'un job basée sur la taille du fichier
     */
    getJobPriority(jobData) {
        const sizeInMB = jobData.size / (1024 * 1024);
        
        // Plus le fichier est petit, plus la priorité est haute
        if (sizeInMB < 10) return 10;      // Très haute priorité
        if (sizeInMB < 100) return 5;      // Priorité normale
        return 1;                          // Basse priorité
    }

    /**
     * Obtenir les statistiques de la queue
     */
    async getQueueStats() {
        try {
            if (!this.initialized) {
                return null;
            }

            const waiting = await this.processingQueue.getWaiting();
            const active = await this.processingQueue.getActive();
            const completed = await this.processingQueue.getCompleted();
            const failed = await this.processingQueue.getFailed();
            const delayed = await this.processingQueue.getDelayed();
            
            return {
                waiting: waiting.length,
                active: active.length,
                completed: completed.length,
                failed: failed.length,
                delayed: delayed.length,
                total: waiting.length + active.length + completed.length + failed.length + delayed.length
            };
        } catch (error) {
            logger.error('Erreur stats queue:', error);
            return null;
        }
    }

    /**
     * Obtenir les jobs actifs
     */
    async getActiveJobs() {
        try {
            if (!this.initialized) {
                return [];
            }

            const activeJobs = await this.processingQueue.getActive();
            return activeJobs.map(job => ({
                id: job.id,
                jobId: job.data.jobData.id,
                progress: job.progress(),
                timestamp: job.timestamp,
                processedOn: job.processedOn
            }));
        } catch (error) {
            logger.error('Erreur récupération jobs actifs:', error);
            return [];
        }
    }

    /**
     * Nettoyer la queue
     */
    async cleanQueue() {
        try {
            if (!this.initialized) {
                return;
            }

            await this.processingQueue.clean(24 * 60 * 60 * 1000, 'completed'); // 24h
            await this.processingQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // 7 jours
            
            logger.info('Queue nettoyée');
        } catch (error) {
            logger.error('Erreur nettoyage queue:', error);
        }
    }

    /**
     * Fermer la queue
     */
    async close() {
        try {
            if (this.processingQueue) {
                await this.processingQueue.close();
                logger.info('Queue fermée');
            }
        } catch (error) {
            logger.error('Erreur fermeture queue:', error);
        }
    }

    /**
     * Obtenir la queue (pour le worker)
     */
    getQueue() {
        if (!this.initialized) {
            this.init();
        }
        return this.processingQueue;
    }
}

// Singleton
const queueService = new QueueService();

module.exports = {
    addJobToQueue: (jobData, options) => queueService.addJob(jobData, options),
    getQueueStats: () => queueService.getQueueStats(),
    getActiveJobs: () => queueService.getActiveJobs(),
    cleanQueue: () => queueService.cleanQueue(),
    closeQueue: () => queueService.close(),
    processingQueue: queueService.getQueue()
};