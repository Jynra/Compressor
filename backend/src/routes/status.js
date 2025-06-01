// backend/src/routes/status.js
const express = require('express');
const rateLimit = require('express-rate-limit');

const JobService = require('../services/jobService');
const { getQueueStats, getActiveJobs } = require('../services/queueService');
const { ValidationService, validateRequest } = require('../utils/validation');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Rate limiting pour les routes de statut
 */
const statusRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: parseInt(process.env.STATUS_RATE_LIMIT) || 60, // 60 requêtes par minute
    message: {
        success: false,
        error: 'Trop de requêtes de statut'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        return process.env.NODE_ENV === 'development' && 
               process.env.SKIP_RATE_LIMIT === 'true';
    }
});

/**
 * GET /api/status/:jobId
 * Obtenir le statut d'un job spécifique
 */
router.get('/:jobId', 
    statusRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            logger.debug('Demande statut job', { jobId, ip: req.ip });

            // Récupérer le job
            const job = await JobService.getJob(jobId);
            
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé',
                    jobId
                });
            }

            // Calculer des métriques additionnelles
            const currentTime = new Date();
            const createdTime = new Date(job.createdAt);
            const updatedTime = new Date(job.updatedAt);
            
            const timeElapsed = Math.floor((currentTime - createdTime) / 1000); // en secondes
            const timeSinceUpdate = Math.floor((currentTime - updatedTime) / 1000);

            // Calculer l'ETA si en cours de traitement
            let eta = null;
            if (job.status === 'processing' && job.progress > 0) {
                const remainingProgress = 100 - job.progress;
                const progressRate = job.progress / timeElapsed; // progress par seconde
                if (progressRate > 0) {
                    eta = Math.floor(remainingProgress / progressRate);
                }
            }

            // Préparer la réponse
            const response = {
                success: true,
                job: {
                    id: job.id,
                    originalName: job.originalName,
                    type: job.type,
                    status: job.status,
                    progress: parseInt(job.progress) || 0,
                    size: parseInt(job.size),
                    sizeFormatted: job.size ? require('../services/fileService').formatFileSize(parseInt(job.size)) : null,
                    settings: job.settings,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    timeElapsed,
                    timeSinceUpdate,
                    eta
                }
            };

            // Ajouter des informations spécifiques au statut
            switch (job.status) {
                case 'completed':
                    response.job.compressedSize = parseInt(job.compressedSize);
                    response.job.compressedSizeFormatted = job.compressedSize ? 
                        require('../services/fileService').formatFileSize(parseInt(job.compressedSize)) : null;
                    response.job.compressionRatio = parseInt(job.compressionRatio) || 0;
                    response.job.outputPath = job.outputPath;
                    
                    // Calcul des économies
                    if (job.size && job.compressedSize) {
                        const savedBytes = parseInt(job.size) - parseInt(job.compressedSize);
                        response.job.savedBytes = savedBytes;
                        response.job.savedBytesFormatted = require('../services/fileService').formatFileSize(savedBytes);
                    }
                    break;

                case 'error':
                    response.job.error = job.error;
                    break;

                case 'processing':
                    // Informations de progression détaillées
                    if (eta) {
                        response.job.etaFormatted = formatDuration(eta);
                    }
                    break;
            }

            res.json(response);

        } catch (error) {
            logger.error(`Erreur récupération statut job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * GET /api/status
 * Obtenir la liste des jobs avec pagination et filtres
 */
router.get('/',
    statusRateLimit,
    validateRequest.pagination,
    validateRequest.jobFilters,
    async (req, res) => {
        try {
            const { page, limit, sortBy, sortOrder } = req.query;
            const filters = {
                status: req.query.status,
                type: req.query.type,
                dateFrom: req.query.dateFrom,
                dateTo: req.query.dateTo,
                minSize: req.query.minSize,
                maxSize: req.query.maxSize
            };

            logger.debug('Liste jobs demandée', { 
                page, limit, sortBy, sortOrder, filters, ip: req.ip 
            });

            // Récupérer tous les jobs (à optimiser avec vraie pagination plus tard)
            let jobs = await JobService.getAllJobs(limit * 10); // Buffer pour filtrage

            // Appliquer les filtres
            if (filters.status) {
                jobs = jobs.filter(job => job.status === filters.status);
            }
            
            if (filters.type) {
                jobs = jobs.filter(job => job.type === filters.type);
            }

            if (filters.dateFrom) {
                const fromDate = new Date(filters.dateFrom);
                jobs = jobs.filter(job => new Date(job.createdAt) >= fromDate);
            }

            if (filters.dateTo) {
                const toDate = new Date(filters.dateTo);
                jobs = jobs.filter(job => new Date(job.createdAt) <= toDate);
            }

            if (filters.minSize) {
                jobs = jobs.filter(job => parseInt(job.size) >= parseInt(filters.minSize));
            }

            if (filters.maxSize) {
                jobs = jobs.filter(job => parseInt(job.size) <= parseInt(filters.maxSize));
            }

            // Tri
            jobs.sort((a, b) => {
                let valueA = a[sortBy];
                let valueB = b[sortBy];

                // Conversion pour les champs numériques
                if (['size', 'progress'].includes(sortBy)) {
                    valueA = parseInt(valueA) || 0;
                    valueB = parseInt(valueB) || 0;
                }

                // Conversion pour les dates
                if (['createdAt', 'updatedAt'].includes(sortBy)) {
                    valueA = new Date(valueA);
                    valueB = new Date(valueB);
                }

                if (sortOrder === 'asc') {
                    return valueA > valueB ? 1 : -1;
                } else {
                    return valueA < valueB ? 1 : -1;
                }
            });

            // Pagination
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedJobs = jobs.slice(startIndex, endIndex);

            // Enrichir les jobs avec des informations calculées
            const enrichedJobs = paginatedJobs.map(job => {
                const currentTime = new Date();
                const createdTime = new Date(job.createdAt);
                
                return {
                    ...job,
                    size: parseInt(job.size),
                    progress: parseInt(job.progress) || 0,
                    sizeFormatted: job.size ? require('../services/fileService').formatFileSize(parseInt(job.size)) : null,
                    timeElapsed: Math.floor((currentTime - createdTime) / 1000),
                    compressedSize: job.compressedSize ? parseInt(job.compressedSize) : null,
                    compressionRatio: job.compressionRatio ? parseInt(job.compressionRatio) : null
                };
            });

            // Métadonnées de pagination
            const totalJobs = jobs.length;
            const totalPages = Math.ceil(totalJobs / limit);
            const hasNextPage = page < totalPages;
            const hasPrevPage = page > 1;

            res.json({
                success: true,
                jobs: enrichedJobs,
                pagination: {
                    page,
                    limit,
                    total: totalJobs,
                    pages: totalPages,
                    hasNext: hasNextPage,
                    hasPrev: hasPrevPage
                },
                filters: filters,
                sort: { sortBy, sortOrder }
            });

        } catch (error) {
            logger.error('Erreur récupération liste jobs:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * GET /api/status/stats
 * Statistiques globales du système
 */
router.get('/stats/global', statusRateLimit, async (req, res) => {
    try {
        logger.debug('Statistiques globales demandées', { ip: req.ip });

        // Récupérer les stats des jobs
        const jobStats = await JobService.getJobStats();
        
        // Récupérer les stats de la queue
        const queueStats = await getQueueStats();
        
        // Récupérer les jobs actifs
        const activeJobs = await getActiveJobs();

        // Calculer des métriques additionnelles
        const currentTime = new Date();
        const last24h = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
        
        // Récupérer les jobs des dernières 24h
        const recentJobs = await JobService.getAllJobs(1000);
        const jobs24h = recentJobs.filter(job => 
            new Date(job.createdAt) >= last24h
        );

        // Calculer les métriques de performance
        const completedJobs24h = jobs24h.filter(job => job.status === 'completed');
        const totalSizeProcessed = completedJobs24h.reduce((sum, job) => 
            sum + (parseInt(job.size) || 0), 0
        );
        const totalSizeSaved = completedJobs24h.reduce((sum, job) => {
            const original = parseInt(job.size) || 0;
            const compressed = parseInt(job.compressedSize) || original;
            return sum + (original - compressed);
        }, 0);

        const avgCompressionRatio = completedJobs24h.length > 0 ?
            completedJobs24h.reduce((sum, job) => 
                sum + (parseInt(job.compressionRatio) || 0), 0
            ) / completedJobs24h.length : 0;

        // Calculer les temps de traitement moyens
        const avgProcessingTimes = {};
        const jobsByType = completedJobs24h.reduce((acc, job) => {
            if (!acc[job.type]) acc[job.type] = [];
            
            const created = new Date(job.createdAt);
            const updated = new Date(job.updatedAt);
            const processingTime = Math.floor((updated - created) / 1000);
            
            acc[job.type].push(processingTime);
            return acc;
        }, {});

        Object.keys(jobsByType).forEach(type => {
            const times = jobsByType[type];
            avgProcessingTimes[type] = times.length > 0 ?
                Math.floor(times.reduce((a, b) => a + b, 0) / times.length) : 0;
        });

        res.json({
            success: true,
            stats: {
                jobs: {
                    total: jobStats.total,
                    uploaded: jobStats.uploaded || 0,
                    queued: jobStats.queued || 0,
                    processing: jobStats.processing || 0,
                    completed: jobStats.completed || 0,
                    error: jobStats.error || 0,
                    last24h: jobs24h.length,
                    completed24h: completedJobs24h.length
                },
                queue: queueStats || {
                    waiting: 0,
                    active: 0,
                    completed: 0,
                    failed: 0,
                    delayed: 0
                },
                performance: {
                    totalSizeProcessed,
                    totalSizeProcessedFormatted: require('../services/fileService').formatFileSize(totalSizeProcessed),
                    totalSizeSaved,
                    totalSizeSavedFormatted: require('../services/fileService').formatFileSize(totalSizeSaved),
                    avgCompressionRatio: Math.round(avgCompressionRatio),
                    avgProcessingTimes
                },
                activeJobs: activeJobs || [],
                timestamp: currentTime.toISOString()
            }
        });

    } catch (error) {
        logger.error('Erreur récupération statistiques:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

/**
 * DELETE /api/status/:jobId
 * Supprimer un job et ses fichiers associés
 */
router.delete('/:jobId',
    statusRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            logger.info(`Demande suppression job ${jobId}`, { ip: req.ip });

            // Vérifier que le job existe
            const job = await JobService.getJob(jobId);
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé'
                });
            }

            // Ne pas permettre la suppression des jobs en cours de traitement
            if (job.status === 'processing') {
                return res.status(400).json({
                    success: false,
                    error: 'Impossible de supprimer un job en cours de traitement'
                });
            }

            // Supprimer les fichiers associés
            const FileService = require('../services/fileService');
            
            if (job.filePath) {
                await FileService.deleteFile(job.filePath);
                logger.file(`Fichier source supprimé: ${job.filePath}`);
            }

            if (job.outputPath) {
                await FileService.deleteFile(job.outputPath);
                logger.file(`Fichier de sortie supprimé: ${job.outputPath}`);
            }

            // Supprimer le job de Redis
            await JobService.deleteJob(jobId);

            logger.info(`Job ${jobId} supprimé avec succès`);

            res.json({
                success: true,
                message: 'Job supprimé avec succès',
                jobId
            });

        } catch (error) {
            logger.error(`Erreur suppression job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * POST /api/status/:jobId/retry
 * Relancer un job en erreur
 */
router.post('/:jobId/retry',
    statusRateLimit,
    validateRequest.jobId,
    async (req, res) => {
        try {
            const { jobId } = req.params;
            
            logger.info(`Demande retry job ${jobId}`, { ip: req.ip });

            // Vérifier que le job existe
            const job = await JobService.getJob(jobId);
            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job non trouvé'
                });
            }

            // Vérifier que le job est en erreur
            if (job.status !== 'error') {
                return res.status(400).json({
                    success: false,
                    error: 'Seuls les jobs en erreur peuvent être relancés'
                });
            }

            // Vérifier que le fichier source existe encore
            const FileService = require('../services/fileService');
            const fileExists = await FileService.getFileStats(job.filePath);
            if (!fileExists) {
                return res.status(400).json({
                    success: false,
                    error: 'Fichier source introuvable, impossible de relancer'
                });
            }

            // Remettre le job en état initial
            await JobService.updateJob(jobId, {
                status: 'uploaded',
                progress: 0,
                error: null,
                outputPath: null,
                compressedSize: null,
                compressionRatio: null,
                updatedAt: new Date().toISOString()
            });

            // Remettre en queue
            const { addJobToQueue } = require('../services/queueService');
            await addJobToQueue(job);
            
            await JobService.updateJob(jobId, { status: 'queued' });

            logger.job(jobId, 'Job relancé avec succès');

            res.json({
                success: true,
                message: 'Job relancé avec succès',
                jobId,
                status: 'queued'
            });

        } catch (error) {
            logger.error(`Erreur retry job ${req.params.jobId}:`, error);
            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur'
            });
        }
    }
);

/**
 * GET /api/status/types/stats
 * Statistiques par type de fichier
 */
router.get('/types/stats', statusRateLimit, async (req, res) => {
    try {
        logger.debug('Statistiques par type demandées', { ip: req.ip });

        // Récupérer tous les jobs récents
        const jobs = await JobService.getAllJobs(1000);
        
        // Grouper par type
        const statsByType = {};
        const FileService = require('../services/fileService');
        
        jobs.forEach(job => {
            const type = job.type || 'unknown';
            
            if (!statsByType[type]) {
                statsByType[type] = {
                    total: 0,
                    uploaded: 0,
                    queued: 0,
                    processing: 0,
                    completed: 0,
                    error: 0,
                    totalSize: 0,
                    totalCompressed: 0,
                    totalSaved: 0,
                    avgCompressionRatio: 0,
                    processingTimes: []
                };
            }

            const stats = statsByType[type];
            stats.total++;
            stats[job.status]++;
            
            const size = parseInt(job.size) || 0;
            stats.totalSize += size;
            
            if (job.status === 'completed') {
                const compressed = parseInt(job.compressedSize) || size;
                stats.totalCompressed += compressed;
                stats.totalSaved += (size - compressed);
                
                // Calculer le temps de traitement
                if (job.createdAt && job.updatedAt) {
                    const processingTime = new Date(job.updatedAt) - new Date(job.createdAt);
                    stats.processingTimes.push(Math.floor(processingTime / 1000));
                }
            }
        });

        // Calculer les moyennes
        Object.keys(statsByType).forEach(type => {
            const stats = statsByType[type];
            
            // Ratio de compression moyen
            if (stats.totalSize > 0) {
                stats.avgCompressionRatio = Math.round(
                    ((stats.totalSize - stats.totalCompressed) / stats.totalSize) * 100
                );
            }
            
            // Temps de traitement moyen
            if (stats.processingTimes.length > 0) {
                stats.avgProcessingTime = Math.floor(
                    stats.processingTimes.reduce((a, b) => a + b, 0) / stats.processingTimes.length
                );
            } else {
                stats.avgProcessingTime = 0;
            }
            
            // Formater les tailles
            stats.totalSizeFormatted = FileService.formatFileSize(stats.totalSize);
            stats.totalCompressedFormatted = FileService.formatFileSize(stats.totalCompressed);
            stats.totalSavedFormatted = FileService.formatFileSize(stats.totalSaved);
            
            // Supprimer les temps bruts
            delete stats.processingTimes;
        });

        res.json({
            success: true,
            statsByType,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur statistiques par type:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

/**
 * Fonction utilitaire pour formater une durée en secondes
 */
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

module.exports = router;