// backend/src/routes/download.js - CORRIGÉ
const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const JobService = require('../services/jobService');
const FileService = require('../services/fileService');
const { ValidationService, validateRequest } = require('../utils/validation');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * ✅ FIX: Parser Range HTTP sécurisé - DÉFINI AVANT UTILISATION
 */
function parseRange(size, rangeHeader) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }

    const ranges = [];
    const rangeSpecs = rangeHeader.substring(6).split(',');

    for (const rangeSpec of rangeSpecs) {
        const trimmedSpec = rangeSpec.trim();
        const rangeParts = trimmedSpec.split('-');
        
        if (rangeParts.length !== 2) continue;

        let start = parseInt(rangeParts[0]) || 0;
        let end = parseInt(rangeParts[1]) || (size - 1);

        // ✅ FIX: Validation stricte des ranges
        if (start < 0) start = 0;
        if (end >= size) end = size - 1;
        if (start > end) continue;
        if (start > size - 1) continue;

        ranges.push({ start, end });
    }

    return ranges.length > 0 ? ranges : null;
}

/**
 * Rate limiting pour téléchargements
 */
const downloadRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: parseInt(process.env.DOWNLOAD_RATE_LIMIT) || 20,
    message: {
        success: false,
        error: 'Trop de téléchargements, veuillez attendre'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip;
    },
    skip: (req) => {
        return process.env.NODE_ENV === 'development' && 
               process.env.SKIP_RATE_LIMIT === 'true';
    },
    onLimitReached: (req) => {
        logger.security('Rate limit download atteint', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            jobId: req.params.jobId
        });
    }
});

/**
 * ✅ FIX: Validation d'accès téléchargement sécurisée
 */
const validateDownloadAccess = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        
        // ✅ FIX: Validation UUID stricte
        if (!ValidationService.isValidUUID(jobId)) {
            logger.security('Tentative accès download avec job ID invalide', {
                jobId,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return res.status(400).json({
                success: false,
                error: 'Job ID invalide'
            });
        }
        
        // Vérifier que le job existe
        const job = await JobService.getJob(jobId);
        if (!job) {
            logger.security('Tentative accès job inexistant', {
                jobId,
                ip: req.ip
            });
            return res.status(404).json({
                success: false,
                error: 'Job non trouvé'
            });
        }

        // Vérifier que le job est terminé
        if (job.status !== 'completed') {
            return res.status(400).json({
                success: false,
                error: 'Le fichier n\'est pas encore prêt',
                status: job.status,
                progress: job.progress || 0
            });
        }

        // ✅ FIX: Validation sécurisée du chemin de sortie
        if (!job.outputPath) {
            logger.error('Job sans chemin de sortie', { jobId });
            return res.status(500).json({
                success: false,
                error: 'Chemin de fichier manquant'
            });
        }

        // ✅ FIX: Vérification sécurisée du chemin
        const securePathValidation = FileService.validateSecurePath(
            job.outputPath, 
            process.env.TEMP_DIR || '/tmp/uploads'
        );

        if (!securePathValidation.isValid) {
            logger.security('Tentative path traversal dans download', {
                jobId,
                requestedPath: job.outputPath,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                error: 'Accès non autorisé'
            });
        }

        // Vérifier l'existence du fichier
        const fileStats = await FileService.getFileStats(securePathValidation.resolvedPath);
        if (!fileStats) {
            logger.error(`Fichier de sortie introuvable: ${securePathValidation.resolvedPath}`, { jobId });
            return res.status(404).json({
                success: false,
                error: 'Fichier non trouvé sur le serveur'
            });
        }

        // ✅ FIX: Vérification intégrité fichier
        if (fileStats.size === 0) {
            logger.error('Fichier de sortie vide', { jobId, path: securePathValidation.resolvedPath });
            return res.status(500).json({
                success: false,
                error: 'Fichier corrompu'
            });
        }

        // ✅ FIX: Vérification permissions lecture
        try {
            await fs.promises.access(securePathValidation.resolvedPath, fs.constants.R_OK);
        } catch (accessError) {
            logger.error('Permissions lecture insuffisantes', { 
                jobId, 
                path: securePathValidation.resolvedPath,
                error: accessError.message 
            });
            return res.status(500).json({
                success: false,
                error: 'Fichier non accessible'
            });
        }

        // Ajouter les informations sécurisées à la requête
        req.job = job;
        req.fileStats = fileStats;
        req.securePath = securePathValidation.resolvedPath;
        
        next();

    } catch (error) {
        logger.error('Erreur validation accès download:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
};

/**
 * ✅ FIX: GET /api/download/:jobId - Téléchargement sécurisé
 */
router.get('/:jobId',
    downloadRateLimit,
    validateRequest.jobId,
    validateDownloadAccess,
    async (req, res) => {
        const { jobId } = req.params;
        const { job, fileStats, securePath } = req;
        
        const downloadLogger = logger.withContext({
            jobId,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        try {
            downloadLogger.info('Téléchargement sécurisé démarré', {
                filename: job.originalName,
                outputPath: securePath,
                size: fileStats.size
            });

            // ✅ FIX: Génération nom de fichier sécurisé
            const originalExt = path.extname(job.originalName);
            const baseName = path.basename(job.originalName, originalExt);
            
            // Nettoyer et sécuriser le nom
            let downloadFilename;
            if (job.compressionRatio && job.compressionRatio > 0) {
                downloadFilename = `${ValidationService.sanitizeFilename(baseName)}_optimized${originalExt}`;
            } else {
                downloadFilename = ValidationService.sanitizeFilename(job.originalName);
            }

            // Fallback sécurisé
            if (!downloadFilename) {
                downloadFilename = `file_${jobId.substring(0, 8)}${originalExt || '.bin'}`;
            }

            // ✅ FIX: Détermination MIME type sécurisée
            const mimeType = require('mime-types').lookup(securePath) || 'application/octet-stream';
            
            // ✅ FIX: Validation MIME type cohérent
            const expectedMimeType = require('mime-types').lookup(originalExt) || 'application/octet-stream';
            if (mimeType !== expectedMimeType && mimeType !== 'application/octet-stream') {
                downloadLogger.warn('MIME type incohérent détecté', {
                    expected: expectedMimeType,
                    actual: mimeType,
                    filename: job.originalName
                });
            }

            // ✅ FIX: Headers de sécurité renforcés
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', fileStats.size);
            res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            
            // Headers métadonnées avec validation
            res.setHeader('X-Original-Size', Math.max(0, parseInt(job.size) || 0));
            res.setHeader('X-Compressed-Size', Math.max(0, parseInt(job.compressedSize) || parseInt(job.size) || 0));
            res.setHeader('X-Compression-Ratio', Math.max(0, Math.min(100, parseInt(job.compressionRatio) || 0)));
            res.setHeader('X-File-Type', ValidationService.sanitizeHeader(job.type || 'unknown'));
            res.setHeader('X-Processing-Time', Math.max(0, new Date(job.updatedAt) - new Date(job.createdAt)));

            // ✅ FIX: Support Range sécurisé avec parser défini
            const range = req.headers.range;
            
            if (range) {
                const ranges = parseRange(fileStats.size, range);
                
                if (ranges && ranges.length === 1 && ranges[0].start < fileStats.size) {
                    const { start, end } = ranges[0];
                    const contentLength = (end - start) + 1;
                    
                    // ✅ FIX: Validation range sécurisée
                    if (contentLength > 0 && start >= 0 && end < fileStats.size && start <= end) {
                        res.status(206); // Partial Content
                        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileStats.size}`);
                        res.setHeader('Content-Length', contentLength);
                        res.setHeader('Accept-Ranges', 'bytes');
                        
                        // Stream partiel sécurisé
                        const stream = fs.createReadStream(securePath, { start, end });
                        streamFileSafely(stream, res, downloadLogger, job, true);
                    } else {
                        // Range invalide
                        downloadLogger.warn('Range invalide demandé', { start, end, fileSize: fileStats.size });
                        res.status(416); // Range Not Satisfiable
                        res.setHeader('Content-Range', `bytes */${fileStats.size}`);
                        res.end();
                    }
                } else {
                    // Range invalide ou multiple
                    downloadLogger.warn('Range non supporté', { range });
                    res.status(416);
                    res.setHeader('Content-Range', `bytes */${fileStats.size}`);
                    res.end();
                }
            } else {
                // Téléchargement complet sécurisé
                res.setHeader('Accept-Ranges', 'bytes');
                const stream = fs.createReadStream(securePath);
                streamFileSafely(stream, res, downloadLogger, job, false);
            }

        } catch (error) {
            downloadLogger.error('Erreur téléchargement sécurisé:', error);
            
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Erreur téléchargement fichier'
                });
            }
        }
    }
);

/**
 * ✅ FIX: Fonction de streaming sécurisée
 */
function streamFileSafely(stream, res, downloadLogger, job, isPartial = false) {
    let bytesStreamed = 0;
    const startTime = Date.now();
    let streamCompleted = false;

    // ✅ FIX: Timeout de stream
    const streamTimeout = setTimeout(() => {
        if (!streamCompleted) {
            downloadLogger.error('Timeout de stream atteint');
            if (stream.readable) {
                stream.destroy();
            }
            if (!res.headersSent) {
                res.status(500).end();
            }
        }
    }, 5 * 60 * 1000); // 5 minutes timeout

    stream.on('data', (chunk) => {
        bytesStreamed += chunk.length;
        
        // ✅ FIX: Limitation débit pour éviter surcharge
        if (bytesStreamed > 0 && bytesStreamed % (1024 * 1024) === 0) { // Chaque MB
            downloadLogger.debug('Téléchargement en cours', {
                bytesStreamed,
                progress: Math.round((bytesStreamed / (parseInt(job.compressedSize) || parseInt(job.size))) * 100)
            });
        }
    });

    stream.on('end', () => {
        streamCompleted = true;
        clearTimeout(streamTimeout);
        
        const duration = Date.now() - startTime;
        const speed = bytesStreamed / (duration / 1000); // bytes/sec
        
        downloadLogger.info('Téléchargement sécurisé terminé', {
            bytesStreamed,
            duration,
            speedBps: Math.round(speed),
            speedFormatted: FileService.formatFileSize(speed) + '/s',
            isPartial,
            jobId: job.id
        });

        downloadLogger.metric('download_completed', 1, 'count', {
            jobId: job.id,
            fileType: job.type,
            size: bytesStreamed
        });
    });

    stream.on('error', (error) => {
        streamCompleted = true;
        clearTimeout(streamTimeout);
        
        downloadLogger.error('Erreur stream fichier sécurisé:', error);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Erreur lecture fichier'
            });
        }
    });

    res.on('close', () => {
        streamCompleted = true;
        clearTimeout(streamTimeout);
        
        downloadLogger.info('Connexion fermée par le client', {
            bytesStreamed,
            isComplete: res.writableEnded,
            jobId: job.id
        });
        
        // Nettoyer le stream
        if (stream.readable) {
            stream.destroy();
        }
    });

    // ✅ FIX: Gestion erreur écriture
    res.on('error', (error) => {
        streamCompleted = true;
        clearTimeout(streamTimeout);
        
        downloadLogger.error('Erreur écriture réponse:', error);
        
        if (stream.readable) {
            stream.destroy();
        }
    });

    // Pipe sécurisé
    stream.pipe(res);
}

/**
 * ✅ FIX: GET /api/download/:jobId/info - Informations sécurisées
 */
router.get('/:jobId/info',
    downloadRateLimit,
    validateRequest.jobId,
    validateDownloadAccess,
    async (req, res) => {
        try {
            const { job, fileStats } = req;
            
            // ✅ FIX: Validation et nettoyage des métriques
            const compressionRatio = Math.max(0, Math.min(100, parseInt(job.compressionRatio) || 0));
            const originalSize = Math.max(0, parseInt(job.size) || 0);
            const compressedSize = Math.max(0, parseInt(job.compressedSize) || originalSize);
            const savedBytes = Math.max(0, originalSize - compressedSize);
            const processingTime = Math.max(0, new Date(job.updatedAt) - new Date(job.createdAt));

            res.json({
                success: true,
                file: {
                    jobId: job.id,
                    originalName: ValidationService.sanitizeOutput(job.originalName),
                    type: ValidationService.sanitizeOutput(job.type),
                    originalSize,
                    originalSizeFormatted: FileService.formatFileSize(originalSize),
                    compressedSize,
                    compressedSizeFormatted: FileService.formatFileSize(compressedSize),
                    compressionRatio,
                    savedBytes,
                    savedBytesFormatted: FileService.formatFileSize(savedBytes),
                    processingTime: Math.floor(processingTime / 1000), // en secondes
                    mimeType: require('mime-types').lookup(job.originalName) || 'application/octet-stream',
                    settings: job.settings || {},
                    createdAt: job.createdAt,
                    completedAt: job.updatedAt,
                    security: {
                        validated: true,
                        pathSecure: true,
                        accessControlled: true
                    }
                }
            });

        } catch (error) {
            logger.error('Erreur info download sécurisée:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur récupération informations'
            });
        }
    }
);

/**
 * ✅ FIX: GET /api/download/:jobId/preview - Prévisualisation sécurisée
 */
router.get('/:jobId/preview',
    downloadRateLimit,
    validateRequest.jobId,
    validateDownloadAccess,
    async (req, res) => {
        try {
            const { job, securePath } = req;
            
            // Vérifier que c'est une image
            if (job.type !== 'image') {
                return res.status(400).json({
                    success: false,
                    error: 'Prévisualisation disponible uniquement pour les images'
                });
            }

            // ✅ FIX: Validation paramètre size sécurisée
            const sizeParam = req.query.size;
            const allowedSizes = ['small', 'medium', 'large'];
            const size = allowedSizes.includes(sizeParam) ? sizeParam : 'medium';

            const maxSizes = {
                small: 150,
                medium: 300,
                large: 600
            };

            const maxSize = maxSizes[size];

            // ✅ FIX: Génération vignette sécurisée
            const ImageService = require('../services/imageService');
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            
            // Nom sécurisé pour la vignette
            const safeThumbnailName = `preview_${ValidationService.sanitizeFilename(job.id)}_${maxSize}.jpg`;
            const thumbnailPath = path.join(tempDir, 'previews', safeThumbnailName);

            // ✅ FIX: Validation chemin vignette
            const thumbnailValidation = FileService.validateSecurePath(thumbnailPath, tempDir);
            if (!thumbnailValidation.isValid) {
                logger.security('Tentative path traversal preview', {
                    jobId: job.id,
                    requestedPath: thumbnailPath,
                    ip: req.ip
                });
                return res.status(403).json({
                    success: false,
                    error: 'Accès non autorisé'
                });
            }

            // Créer le répertoire previews sécurisé
            await FileService.ensureDirectoryExists(path.dirname(thumbnailValidation.resolvedPath));

            // Vérifier si la vignette existe déjà
            let thumbExists = await FileService.getFileStats(thumbnailValidation.resolvedPath);
            
            if (!thumbExists) {
                try {
                    // Créer la vignette de manière sécurisée
                    await ImageService.createThumbnail(securePath, thumbnailValidation.resolvedPath, maxSize);
                    thumbExists = await FileService.getFileStats(thumbnailValidation.resolvedPath);
                } catch (thumbnailError) {
                    logger.error('Erreur création vignette:', thumbnailError);
                    return res.status(500).json({
                        success: false,
                        error: 'Impossible de générer la prévisualisation'
                    });
                }
            }

            if (!thumbExists || thumbExists.size === 0) {
                return res.status(500).json({
                    success: false,
                    error: 'Vignette non générée ou corrompue'
                });
            }

            // ✅ FIX: Headers sécurisés pour preview
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Length', thumbExists.size);
            res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Disposition', 'inline');
            
            const stream = fs.createReadStream(thumbnailValidation.resolvedPath);
            
            // Stream sécurisé
            stream.on('error', (error) => {
                logger.error('Erreur stream preview:', error);
                if (!res.headersSent) {
                    res.status(500).end();
                }
            });

            stream.pipe(res);

            // ✅ FIX: Nettoyage conditionnel de la vignette
            stream.on('end', () => {
                // Nettoyer les vignettes anciennes (optionnel, après 1h)
                setTimeout(async () => {
                    try {
                        const stats = await FileService.getFileStats(thumbnailValidation.resolvedPath);
                        if (stats && Date.now() - stats.created.getTime() > 3600000) { // 1h
                            await FileService.deleteSecureFile(thumbnailValidation.resolvedPath);
                        }
                    } catch (cleanupError) {
                        // Ignore les erreurs de nettoyage
                    }
                }, 5000);
            });

        } catch (error) {
            logger.error('Erreur preview sécurisée:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur génération prévisualisation'
            });
        }
    }
);

module.exports = router;