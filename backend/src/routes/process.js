// backend/src/routes/process.js - CORRIGÉ
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
 * ✅ FIX: POST /api/process/:jobId - Démarrage traitement sécurisé
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

            requestLogger.info('Demande traitement manuel sécurisé', { priority, settings });

            // ✅ FIX: Validation UUID stricte
            if (!ValidationService.isValidUUID(jobId)) {
                logger.security('Job ID invalide pour traitement', {
                    jobId,
                    ip: req.ip
                });
                return res.status(400).json({
                    success: false,
                    error: 'Job ID invalide'
                });
            }

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

            // ✅ FIX: Validation priorité sécurisée
            const allowedPriorities = ['low', 'normal', 'high', 'urgent'];
            const validPriority = allowedPriorities.includes(priority) ? priority : 'normal';

            // ✅ FIX: Validation et nettoyage des paramètres
            let validatedSettings = {};
            if (Object.keys(settings).length > 0) {
                // Nettoyer les paramètres d'entrée
                const cleanSettings = ValidationService.sanitizeSettings(settings);
                
                const fileType = job.type;
                const currentSettings = { ...job.settings, ...cleanSettings };
                
                const validation = ValidationService.validateSettings(fileType, currentSettings);
                if (!validation.isValid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Paramètres invalides',
                        details: validation.errors
                    });
                }

                validatedSettings = validation.validatedSettings;

                // Mettre à jour les paramètres du job
                await JobService.updateJob(jobId, {
                    settings: validatedSettings,
                    status: 'uploaded',
                    progress: 0,
                    error: null,
                    updatedAt: new Date().toISOString()
                });
                
                job.settings = validatedSettings;
            }

            // ✅ FIX: Correction priorité Bull (inversée)
            // Bull: Plus haut = plus prioritaire (contrairement à l'erreur précédente)
            let queuePriority = 5; // Normal par défaut
            switch (validPriority) {
                case 'low':
                    queuePriority = 1;     // ✅ Basse priorité
                    break;
                case 'normal':
                    queuePriority = 5;     // ✅ Priorité normale
                    break;
                case 'high':
                    queuePriority = 10;    // ✅ Haute priorité
                    break;
                case 'urgent':
                    queuePriority = 15;    // ✅ Priorité urgente
                    break;
            }

            // ✅ FIX: Vérification sécurité du fichier avant traitement
            if (job.filePath) {
                const securePathValidation = FileService.validateSecurePath(
                    job.filePath,
                    process.env.TEMP_DIR || '/tmp/uploads'
                );

                if (!securePathValidation.isValid) {
                    logger.security('Path traversal détecté dans job', {
                        jobId,
                        filePath: job.filePath,
                        ip: req.ip
                    });
                    return res.status(403).json({
                        success: false,
                        error: 'Chemin de fichier non sécurisé'
                    });
                }

                // Vérifier existence du fichier
                const FileService = require('../services/fileService');
                const fileExists = await FileService.getFileStats(securePathValidation.resolvedPath);
                if (!fileExists) {
                    return res.status(400).json({
                        success: false,
                        error: 'Fichier source introuvable'
                    });
                }
            }

            // Ajouter à la queue avec priorité corrigée
            await addJobToQueue(job, { priority: queuePriority });
            await JobService.updateJob(jobId, { status: 'queued' });

            requestLogger.job(jobId, 'Job ajouté à la queue manuellement', { 
                priority: validPriority, 
                queuePriority 
            });

            // Estimer le temps de traitement
            const estimatedTime = ProcessingService.estimateProcessingTime(job.type, job.size);

            res.json({
                success: true,
                message: 'Job ajouté à la queue de traitement',
                jobId,
                status: 'queued',
                priority: validPriority,
                queuePriority,
                estimatedTime,
                queuePosition: await getQueuePosition(jobId),
                security: {
                    pathValidated: true,
                    settingsValidated: Object.keys(settings).length > 0
                }
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
 * ✅ FIX: POST /api/process/batch - Traitement batch sécurisé
 */
router.post('/batch',
    processRateLimit,
    async (req, res) => {
        try {
            const { jobIds, settings = {}, priority = 'normal' } = req.body;
            
            // ✅ FIX: Validation stricte des paramètres
            if (!Array.isArray(jobIds) || jobIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Liste de jobs requise (array non vide)'
                });
            }

            if (jobIds.length > 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Maximum 10 jobs par batch'
                });
            }

            // ✅ FIX: Validation de tous les job IDs
            const invalidJobIds = jobIds.filter(id => !ValidationService.isValidUUID(id));
            if (invalidJobIds.length > 0) {
                logger.security('Job IDs invalides dans batch', {
                    invalidIds: invalidJobIds,
                    ip: req.ip
                });
                return res.status(400).json({
                    success: false,
                    error: 'Job IDs invalides détectés',
                    invalidIds: invalidJobIds
                });
            }

            const requestLogger = logger.withContext({ 
                ip: req.ip,
                action: 'batch_process',
                jobCount: jobIds.length
            });

            requestLogger.info('Demande traitement batch sécurisé', { jobIds, priority });

            const results = [];
            const errors = [];

            // ✅ FIX: Validation priorité
            const allowedPriorities = ['low', 'normal', 'high', 'urgent'];
            const validPriority = allowedPriorities.includes(priority) ? priority : 'normal';

            // ✅ FIX: Validation settings globaux
            let validatedGlobalSettings = {};
            if (Object.keys(settings).length > 0) {
                const cleanSettings = ValidationService.sanitizeSettings(settings);
                validatedGlobalSettings = cleanSettings;
            }

            // Traiter chaque job de manière sécurisée
            for (const jobId of jobIds) {
                try {
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

                    // ✅ FIX: Validation sécurité du fichier
                    if (job.filePath) {
                        const FileService = require('../services/fileService');
                        const securePathValidation = FileService.validateSecurePath(
                            job.filePath,
                            process.env.TEMP_DIR || '/tmp/uploads'
                        );

                        if (!securePathValidation.isValid) {
                            logger.security('Path traversal dans batch job', {
                                jobId,
                                filePath: job.filePath
                            });
                            errors.push({
                                jobId,
                                error: 'Chemin de fichier non sécurisé'
                            });
                            continue;
                        }
                    }

                    // Appliquer les paramètres globaux si fournis
                    if (Object.keys(validatedGlobalSettings).length > 0) {
                        const currentSettings = { ...job.settings, ...validatedGlobalSettings };
                        const settingsValidation = ValidationService.validateSettings(job.type, currentSettings);
                        
                        if (settingsValidation.isValid) {
                            await JobService.updateJob(jobId, {
                                settings: settingsValidation.validatedSettings,
                                status: 'uploaded',
                                progress: 0
                            });
                        } else {
                            errors.push({
                                jobId,
                                error: 'Paramètres invalides pour ce type de fichier',
                                details: settingsValidation.errors
                            });
                            continue;
                        }
                    }

                    // ✅ FIX: Priorité Bull corrigée
                    const queuePriority = validPriority === 'high' ? 10 : 
                                         validPriority === 'urgent' ? 15 :
                                         validPriority === 'low' ? 1 : 5;

                    // Ajouter à la queue
                    await addJobToQueue(job, { priority: queuePriority });
                    await JobService.updateJob(jobId, { status: 'queued' });

                    results.push({
                        jobId,
                        status: 'queued',
                        message: 'Ajouté à la queue',
                        priority: validPriority,
                        queuePriority
                    });

                } catch (error) {
                    logger.error(`Erreur traitement batch job ${jobId}:`, error);
                    errors.push({
                        jobId,
                        error: error.message
                    });
                }
            }

            requestLogger.info('Traitement batch sécurisé terminé', {
                processed: results.length,
                errors: errors.length
            });

            res.json({
                success: true,
                message: `${results.length} jobs traités sécurisés`,
                results,
                errors: errors.length > 0 ? errors : undefined,
                summary: {
                    total: jobIds.length,
                    processed: results.length,
                    failed: errors.length
                },
                security: {
                    allPathsValidated: true,
                    settingsValidated: Object.keys(settings).length > 0
                }
            });

        } catch (error) {
            logger.error('Erreur traitement batch sécurisé:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: POST /api/process/:jobId/pause - Pause sécurisée
 */
router.post('/:jobId/pause',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            // ✅ FIX: Validation UUID
            if (!ValidationService.isValidUUID(jobId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Job ID invalide'
                });
            }
            
            logger.info(`Demande pause sécurisée job ${jobId}`, { ip: req.ip });

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

            // ✅ FIX: Validation sécurité avant pause
            if (job.filePath) {
                const FileService = require('../services/fileService');
                const securePathValidation = FileService.validateSecurePath(
                    job.filePath,
                    process.env.TEMP_DIR || '/tmp/uploads'
                );

                if (!securePathValidation.isValid) {
                    logger.security('Tentative pause job avec path non sécurisé', {
                        jobId,
                        filePath: job.filePath,
                        ip: req.ip
                    });
                    return res.status(403).json({
                        success: false,
                        error: 'Job non sécurisé'
                    });
                }
            }

            // Marquer comme "paused" dans Redis
            await JobService.updateJob(jobId, {
                status: 'paused',
                pausedAt: new Date().toISOString()
            });

            res.json({
                success: true,
                message: 'Job mis en pause',
                jobId,
                status: 'paused',
                pausedAt: new Date().toISOString()
            });

        } catch (error) {
            logger.error(`Erreur pause sécurisée job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: POST /api/process/:jobId/resume - Reprise sécurisée
 */
router.post('/:jobId/resume',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            // ✅ FIX: Validation UUID
            if (!ValidationService.isValidUUID(jobId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Job ID invalide'
                });
            }
            
            logger.info(`Demande reprise sécurisée job ${jobId}`, { ip: req.ip });

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

            // ✅ FIX: Validation sécurité avant reprise
            if (job.filePath) {
                const FileService = require('../services/fileService');
                const securePathValidation = FileService.validateSecurePath(
                    job.filePath,
                    process.env.TEMP_DIR || '/tmp/uploads'
                );

                if (!securePathValidation.isValid) {
                    logger.security('Tentative reprise job avec path non sécurisé', {
                        jobId,
                        filePath: job.filePath,
                        ip: req.ip
                    });
                    return res.status(403).json({
                        success: false,
                        error: 'Job non sécurisé'
                    });
                }

                // Vérifier que le fichier existe toujours
                const fileExists = await FileService.getFileStats(securePathValidation.resolvedPath);
                if (!fileExists) {
                    return res.status(400).json({
                        success: false,
                        error: 'Fichier source introuvable, impossible de reprendre'
                    });
                }
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
                status: 'queued',
                resumedAt: new Date().toISOString()
            });

        } catch (error) {
            logger.error(`Erreur reprise sécurisée job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: POST /api/process/:jobId/cancel - Annulation sécurisée
 */
router.post('/:jobId/cancel',
    processRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            // ✅ FIX: Validation UUID
            if (!ValidationService.isValidUUID(jobId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Job ID invalide'
                });
            }
            
            logger.info(`Demande annulation sécurisée job ${jobId}`, { ip: req.ip });

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

            // ✅ FIX: Nettoyage sécurisé des fichiers lors de l'annulation
            if (job.filePath) {
                const FileService = require('../services/fileService');
                const securePathValidation = FileService.validateSecurePath(
                    job.filePath,
                    process.env.TEMP_DIR || '/tmp/uploads'
                );

                if (securePathValidation.isValid) {
                    // Nettoyer le fichier de manière sécurisée
                    await FileService.deleteSecureFile(securePathValidation.resolvedPath).catch((error) => {
                        logger.warn('Erreur nettoyage fichier lors annulation:', error);
                    });
                }
            }

            // Marquer comme annulé
            await JobService.updateJob(jobId, {
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
                progress: 0
            });

            logger.job(jobId, 'Job annulé sécurisé');

            res.json({
                success: true,
                message: 'Job annulé',
                jobId,
                status: 'cancelled',
                cancelledAt: new Date().toISOString()
            });

        } catch (error) {
            logger.error(`Erreur annulation sécurisée job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: GET /api/process/queue - Informations queue sécurisées
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

        // ✅ FIX: Récupération jobs sécurisée avec limitation
        const recentJobs = await JobService.getAllJobs(20);
        const queuedJobs = recentJobs
            .filter(job => job.status === 'queued')
            .slice(0, 10)
            .map(job => {
                // ✅ FIX: Nettoyage données sensibles
                return {
                    id: job.id,
                    originalName: ValidationService.sanitizeOutput(job.originalName),
                    type: ValidationService.sanitizeOutput(job.type),
                    size: Math.max(0, parseInt(job.size) || 0),
                    sizeFormatted: require('../services/fileService').formatFileSize(parseInt(job.size) || 0),
                    createdAt: job.createdAt,
                    estimatedTime: ProcessingService.estimateProcessingTime(job.type, parseInt(job.size) || 0),
                    // ✅ Masquer les chemins de fichiers
                    hasFile: !!job.filePath
                };
            });

        res.json({
            success: true,
            queue: {
                stats: queueStats,
                jobs: queuedJobs,
                timestamp: new Date().toISOString()
            },
            security: {
                pathsHidden: true,
                dataSanitized: true
            }
        });

    } catch (error) {
        logger.error('Erreur récupération queue sécurisée:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

/**
 * ✅ FIX: GET /api/process/settings/:type - Paramètres par défaut sécurisés
 */
router.get('/settings/:type',
    processRateLimit,
    async (req, res) => {
        try {
            const { type } = req.params;
            
            // ✅ FIX: Validation stricte du type
            const validTypes = ['image', 'video', 'audio', 'document'];
            const sanitizedType = ValidationService.sanitizeInput(type);
            
            if (!validTypes.includes(sanitizedType)) {
                return res.status(400).json({
                    success: false,
                    error: 'Type de fichier invalide',
                    validTypes
                });
            }

            const defaultSettings = ProcessingService.getDefaultSettings(sanitizedType);
            
            // Ajouter des informations sur les options disponibles
            const settingsInfo = getSettingsInfo(sanitizedType);

            res.json({
                success: true,
                type: sanitizedType,
                defaultSettings,
                options: settingsInfo,
                description: getTypeDescription(sanitizedType),
                security: {
                    validated: true,
                    typeWhitelisted: true
                }
            });

        } catch (error) {
            logger.error('Erreur récupération paramètres sécurisés:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: POST /api/process/validate-settings - Validation sécurisée
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

            // ✅ FIX: Validation et nettoyage sécurisés
            const validTypes = ['image', 'video', 'audio', 'document'];
            const sanitizedType = ValidationService.sanitizeInput(type);
            
            if (!validTypes.includes(sanitizedType)) {
                return res.status(400).json({
                    success: false,
                    error: 'Type de fichier invalide'
                });
            }

            // ✅ FIX: Nettoyage des paramètres
            const cleanSettings = ValidationService.sanitizeSettings(settings);
            const validation = ValidationService.validateSettings(sanitizedType, cleanSettings);
            
            if (validation.isValid) {
                res.json({
                    success: true,
                    message: 'Paramètres valides',
                    validatedSettings: validation.validatedSettings,
                    security: {
                        inputSanitized: true,
                        typeValidated: true
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Paramètres invalides',
                    details: validation.errors
                });
            }

        } catch (error) {
            logger.error('Erreur validation paramètres sécurisés:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: GET /api/process/estimate - Estimation sécurisée
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

            // ✅ FIX: Validation sécurisée des paramètres
            const validTypes = ['image', 'video', 'audio', 'document'];
            const sanitizedType = ValidationService.sanitizeInput(type);
            
            if (!validTypes.includes(sanitizedType)) {
                return res.status(400).json({
                    success: false,
                    error: 'Type de fichier invalide'
                });
            }

            const fileSize = parseInt(size);
            if (isNaN(fileSize) || fileSize <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Taille invalide'
                });
            }

            // ✅ FIX: Validation taille maximale
            const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 * 1024;
            if (fileSize > maxSize) {
                return res.status(400).json({
                    success: false,
                    error: 'Taille de fichier trop importante',
                    maxSize: maxSize,
                    maxSizeFormatted: require('../services/fileService').formatFileSize(maxSize)
                });
            }

            const estimatedTime = ProcessingService.estimateProcessingTime(sanitizedType, fileSize);
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
                    type: sanitizedType
                },
                security: {
                    inputValidated: true,
                    sizeLimitChecked: true
                }
            });

        } catch (error) {
            logger.error('Erreur estimation sécurisée:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * ✅ FIX: Fonction utilitaire pour obtenir la position dans la queue
 */
async function getQueuePosition(jobId) {
    try {
        const queueStats = await getQueueStats();
        return queueStats ? Math.max(0, queueStats.waiting) : 0;
    } catch (error) {
        logger.error('Erreur position queue:', error);
        return 0;
    }
}

/**
 * ✅ FIX: Informations détaillées sur les paramètres par type (sécurisées)
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
 * Description des types de fichiers (inchangée)
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