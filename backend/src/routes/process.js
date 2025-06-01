// backend/src/routes/process.js
const express = require('express');
const rateLimit = require('express-rate-limit');

const JobService = require('../services/jobService');
const ProcessingService = require('../services/processingService');
const { addJobToQueue, getQueueStats } = require('../services/queueService');
const { ValidationService, validateRequest } = require('../utils/validation');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Rate limiting pour les routes de traitement
 */
const processRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: parseInt(process.env.PROCESS_RATE_LIMIT) || 30, // 30 requêtes par minute
    message: {
        success: false,
        error: 'Trop de requêtes de traitement'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return process.env.NODE_ENV === 'development' && 
               process.env.SKIP_RATE_LIMIT === 'true';
    }
});

/**
 * POST /api/process/:jobId
 * Démarrer le traitement d'un job spécifique
 */
router.post('/:jobId',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            const { priority = 'normal', settings = {} } = req.body;
            
            const requestLogger = logger.withContext({ 
                jobId, 
                ip: req.ip,
                action: 'manual_process'
            });

            requestLogger.info('Demande traitement manuel', { priority, settings });

            // Récupérer le job
            const job = await JobService.getJob(jobId);
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé'
                });
            }

            // Vérifier l'état du job
            if (job.status === 'processing') {
                return res.status(400).json({
                    success: false,
                    error: 'Job déjà en cours de traitement',
                    status: job.status,
                    progress: job.progress
                });
            }

            if (job.status === 'completed') {
                return res.status(400).json({
                    success: false,
                    error: 'Job déjà terminé',
                    status: job.status
                });
            }

            // Valider les nouveaux paramètres si fournis
            if (Object.keys(settings).length > 0) {
                const fileType = job.type;
                const currentSettings = { ...job.settings, ...settings };
                
                const validation = ValidationService.validateSettings(fileType, currentSettings);
                if (!validation.isValid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Paramètres invalides',
                        details: validation.errors
                    });
                }

                // Mettre à jour les paramètres du job
                await JobService.updateJob(jobId, {
                    settings: validation.validatedSettings,
                    status: 'uploaded',
                    progress: 0,
                    error: null,
                    updatedAt: new Date().toISOString()
                });
                
                job.settings = validation.validatedSettings;
            }

            // Calculer la priorité
            let queuePriority = 5; // Normal
            switch (priority) {
                case 'low':
                    queuePriority = 1;
                    break;
                case 'high':
                    queuePriority = 10;
                    break;
                case 'urgent':
                    queuePriority = 15;
                    break;
            }

            // Ajouter à la queue avec priorité
            await addJobToQueue(job, { priority: queuePriority });
            await JobService.updateJob(jobId, { status: 'queued' });

            requestLogger.job(jobId, 'Job ajouté à la queue manuellement', { priority });

            // Estimer le temps de traitement
            const estimatedTime = ProcessingService.estimateProcessingTime(job.type, job.size);

            res.json({
                success: true,
                message: 'Job ajouté à la queue de traitement',
                jobId,
                status: 'queued',
                priority,
                estimatedTime,
                queuePosition: await getQueuePosition(jobId)
            });

        } catch (error) {
            logger.error(`Erreur traitement job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * POST /api/process/batch
 * Traitement par lot de plusieurs jobs
 */
router.post('/batch',
    processRateLimit,
    async (req, res) => {
        try {
            const { jobIds, settings = {}, priority = 'normal' } = req.body;
            
            if (!Array.isArray(jobIds) || jobIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Liste de jobs requise'
                });
            }

            if (jobIds.length > 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Maximum 10 jobs par batch'
                });
            }

            const requestLogger = logger.withContext({ 
                ip: req.ip,
                action: 'batch_process',
                jobCount: jobIds.length
            });

            requestLogger.info('Demande traitement batch', { jobIds, priority });

            const results = [];
            const errors = [];

            // Traiter chaque job
            for (const jobId of jobIds) {
                try {
                    // Validation de l'ID
                    const validation = ValidationService.validateJobId(jobId);
                    if (!validation.isValid) {
                        errors.push({
                            jobId,
                            error: 'ID de job invalide'
                        });
                        continue;
                    }

                    // Récupérer le job
                    const job = await JobService.getJob(jobId);
                    if (!job) {
                        errors.push({
                            jobId,
                            error: 'Job non trouvé'
                        });
                        continue;
                    }

                    // Vérifier l'état
                    if (['processing', 'completed'].includes(job.status)) {
                        errors.push({
                            jobId,
                            error: `Job ${job.status}`,
                            status: job.status
                        });
                        continue;
                    }

                    // Appliquer les paramètres globaux si fournis
                    if (Object.keys(settings).length > 0) {
                        const currentSettings = { ...job.settings, ...settings };
                        const settingsValidation = ValidationService.validateSettings(job.type, currentSettings);
                        
                        if (settingsValidation.isValid) {
                            await JobService.updateJob(jobId, {
                                settings: settingsValidation.validatedSettings,
                                status: 'uploaded',
                                progress: 0
                            });
                        }
                    }

                    // Ajouter à la queue
                    await addJobToQueue(job, { priority: priority === 'high' ? 10 : 5 });
                    await JobService.updateJob(jobId, { status: 'queued' });

                    results.push({
                        jobId,
                        status: 'queued',
                        message: 'Ajouté à la queue'
                    });

                } catch (error) {
                    errors.push({
                        jobId,
                        error: error.message
                    });
                }
            }

            requestLogger.info('Traitement batch terminé', {
                processed: results.length,
                errors: errors.length
            });

            res.json({
                success: true,
                message: `${results.length} jobs traités`,
                results,
                errors: errors.length > 0 ? errors : undefined,
                summary: {
                    total: jobIds.length,
                    processed: results.length,
                    failed: errors.length
                }
            });

        } catch (error) {
            logger.error('Erreur traitement batch:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * POST /api/process/:jobId/pause
 * Mettre en pause un job en cours (si possible)
 */
router.post('/:jobId/pause',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            logger.info(`Demande pause job ${jobId}`, { ip: req.ip });

            const job = await JobService.getJob(jobId);
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé'
                });
            }

            if (job.status !== 'processing') {
                return res.status(400).json({
                    success: false,
                    error: 'Seuls les jobs en cours peuvent être mis en pause',
                    status: job.status
                });
            }

            // Note: La mise en pause dépend de l'implémentation du worker
            // Pour l'instant, on marque le job comme "paused" dans Redis
            await JobService.updateJob(jobId, {
                status: 'paused',
                pausedAt: new Date().toISOString()
            });

            res.json({
                success: true,
                message: 'Job mis en pause',
                jobId,
                status: 'paused'
            });

        } catch (error) {
            logger.error(`Erreur pause job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * POST /api/process/:jobId/resume
 * Reprendre un job en pause
 */
router.post('/:jobId/resume',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            logger.info(`Demande reprise job ${jobId}`, { ip: req.ip });

            const job = await JobService.getJob(jobId);
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé'
                });
            }

            if (job.status !== 'paused') {
                return res.status(400).json({
                    success: false,
                    error: 'Seuls les jobs en pause peuvent être repris',
                    status: job.status
                });
            }

            // Remettre en queue
            await addJobToQueue(job);
            await JobService.updateJob(jobId, {
                status: 'queued',
                pausedAt: null,
                resumedAt: new Date().toISOString()
            });

            res.json({
                success: true,
                message: 'Job repris',
                jobId,
                status: 'queued'
            });

        } catch (error) {
            logger.error(`Erreur reprise job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * POST /api/process/:jobId/cancel
 * Annuler un job en attente ou en cours
 */
router.post('/:jobId/cancel',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            logger.info(`Demande annulation job ${jobId}`, { ip: req.ip });

            const job = await JobService.getJob(jobId);
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé'
                });
            }

            if (job.status === 'completed') {
                return res.status(400).json({
                    success: false,
                    error: 'Job déjà terminé, impossible d\'annuler',
                    status: job.status
                });
            }

            if (job.status === 'cancelled') {
                return res.status(400).json({
                    success: false,
                    error: 'Job déjà annulé',
                    status: job.status
                });
            }

            // Marquer comme annulé
            await JobService.updateJob(jobId, {
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
                progress: 0
            });

            // TODO: Si en cours de traitement, envoyer signal d'arrêt au worker

            logger.job(jobId, 'Job annulé');

            res.json({
                success: true,
                message: 'Job annulé',
                jobId,
                status: 'cancelled'
            });

        } catch (error) {
            logger.error(`Erreur annulation job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * GET /api/process/queue
 * Informations sur la queue de traitement
 */
router.get('/queue', processRateLimit, async (req, res) => {
    try {
        const queueStats = await getQueueStats();
        
        if (!queueStats) {
            return res.status(500).json({
                success: false,
                error: 'Impossible de récupérer les stats de la queue'
            });
        }

        // Récupérer quelques jobs récents en attente
        const recentJobs = await JobService.getAllJobs(20);
        const queuedJobs = recentJobs
            .filter(job => job.status === 'queued')
            .slice(0, 10)
            .map(job => ({
                id: job.id,
                originalName: job.originalName,
                type: job.type,
                size: parseInt(job.size),
                sizeFormatted: require('../services/fileService').formatFileSize(parseInt(job.size)),
                createdAt: job.createdAt,
                estimatedTime: ProcessingService.estimateProcessingTime(job.type, parseInt(job.size))
            }));

        res.json({
            success: true,
            queue: {
                stats: queueStats,
                jobs: queuedJobs,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error('Erreur récupération queue:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

/**
 * GET /api/process/settings/:type
 * Obtenir les paramètres par défaut pour un type de fichier
 */
router.get('/settings/:type',
    processRateLimit,
    async (req, res) => {
        try {
            const { type } = req.params;
            
            // Valider le type
            const validTypes = ['image', 'video', 'audio', 'document'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Type de fichier invalide',
                    validTypes
                });
            }

            const defaultSettings = ProcessingService.getDefaultSettings(type);
            
            // Ajouter des informations sur les options disponibles
            const settingsInfo = getSettingsInfo(type);

            res.json({
                success: true,
                type,
                defaultSettings,
                options: settingsInfo,
                description: getTypeDescription(type)
            });

        } catch (error) {
            logger.error('Erreur récupération paramètres:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * POST /api/process/validate-settings
 * Valider des paramètres sans créer de job
 */
router.post('/validate-settings',
    processRateLimit,
    async (req, res) => {
        try {
            const { type, settings } = req.body;
            
            if (!type || !settings) {
                return res.status(400).json({
                    success: false,
                    error: 'Type et paramètres requis'
                });
            }

            const validation = ValidationService.validateSettings(type, settings);
            
            if (validation.isValid) {
                res.json({
                    success: true,
                    message: 'Paramètres valides',
                    validatedSettings: validation.validatedSettings
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Paramètres invalides',
                    details: validation.errors
                });
            }

        } catch (error) {
            logger.error('Erreur validation paramètres:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * GET /api/process/estimate
 * Estimation du temps de traitement
 */
router.get('/estimate',
    processRateLimit,
    async (req, res) => {
        try {
            const { type, size } = req.query;
            
            if (!type || !size) {
                return res.status(400).json({
                    success: false,
                    error: 'Type et taille requis'
                });
            }

            const fileSize = parseInt(size);
            if (isNaN(fileSize) || fileSize <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Taille invalide'
                });
            }

            const estimatedTime = ProcessingService.estimateProcessingTime(type, fileSize);
            const queueStats = await getQueueStats();
            
            // Estimation de l'attente en queue
            let queueWaitTime = 0;
            if (queueStats && queueStats.waiting > 0) {
                // Approximation: 30 secondes par job en attente
                queueWaitTime = queueStats.waiting * 30;
            }

            const totalTime = estimatedTime + queueWaitTime;

            res.json({
                success: true,
                estimation: {
                    processingTime: estimatedTime,
                    queueWaitTime,
                    totalTime,
                    queuePosition: queueStats ? queueStats.waiting + 1 : 1,
                    fileSize,
                    fileSizeFormatted: require('../services/fileService').formatFileSize(fileSize),
                    type
                }
            });

        } catch (error) {
            logger.error('Erreur estimation:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * Fonction utilitaire pour obtenir la position dans la queue
 */
async function getQueuePosition(jobId) {
    try {
        const queueStats = await getQueueStats();
        return queueStats ? queueStats.waiting : 0;
    } catch (error) {
        logger.error('Erreur position queue:', error);
        return 0;
    }
}

/**
 * Informations détaillées sur les paramètres par type
 */
function getSettingsInfo(type) {
    const settingsInfo = {
        image: {
            quality: {
                type: 'number',
                min: 1,
                max: 100,
                default: 80,
                description: 'Qualité de compression (1-100)'
            },
            maxWidth: {
                type: 'number',
                min: 100,
                max: 8000,
                default: 1920,
                description: 'Largeur maximale en pixels'
            },
            maxHeight: {
                type: 'number',
                min: 100,
                max: 8000,
                default: 1080,
                description: 'Hauteur maximale en pixels'
            },
            format: {
                type: 'string',
                options: ['auto', 'jpeg', 'png', 'webp', 'avif'],
                default: 'auto',
                description: 'Format de sortie'
            },
            removeMetadata: {
                type: 'boolean',
                default: true,
                description: 'Supprimer les métadonnées EXIF'
            }
        },
        video: {
            codec: {
                type: 'string',
                options: ['h264', 'h265', 'vp9', 'av1'],
                default: 'h264',
                description: 'Codec vidéo'
            },
            crf: {
                type: 'number',
                min: 18,
                max: 51,
                default: 23,
                description: 'Facteur de compression (plus bas = meilleure qualité)'
            },
            preset: {
                type: 'string',
                options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
                default: 'medium',
                description: 'Vitesse d\'encodage vs compression'
            }
        },
        audio: {
            codec: {
                type: 'string',
                options: ['aac', 'mp3', 'ogg', 'flac'],
                default: 'aac',
                description: 'Codec audio'
            },
            bitrate: {
                type: 'string',
                options: ['64k', '128k', '192k', '256k', '320k'],
                default: '128k',
                description: 'Débit binaire'
            },
            sampleRate: {
                type: 'number',
                options: [22050, 44100, 48000],
                default: 44100,
                description: 'Fréquence d\'échantillonnage'
            }
        },
        document: {
            compress: {
                type: 'boolean',
                default: true,
                description: 'Activer la compression'
            },
            quality: {
                type: 'number',
                min: 1,
                max: 100,
                default: 80,
                description: 'Qualité des images intégrées'
            },
            removeMetadata: {
                type: 'boolean',
                default: true,
                description: 'Supprimer les métadonnées'
            }
        }
    };

    return settingsInfo[type] || {};
}

/**
 * Description des types de fichiers
 */
function getTypeDescription(type) {
    const descriptions = {
        image: 'Compression et optimisation d\'images avec redimensionnement automatique',
        video: 'Compression vidéo avec codecs modernes et optimisation pour le streaming',
        audio: 'Compression audio avec normalisation et conversion de format',
        document: 'Optimisation de documents PDF avec compression des images intégrées'
    };

    return descriptions[type] || 'Type de fichier supporté';
}

module.exports = router;