// backend/src/routes/download.js
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
 * Rate limiting pour les téléchargements
 */
const downloadRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: parseInt(process.env.DOWNLOAD_RATE_LIMIT) || 20, // 20 téléchargements par minute
    message: {
        success: false,
        error: 'Trop de téléchargements, veuillez attendre'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit par IP
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
 * Middleware de validation d'accès au téléchargement
 */
const validateDownloadAccess = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        
        // Vérifier que le job existe
        const job = await JobService.getJob(jobId);
        if (!job) {
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

        // Vérifier que le fichier de sortie existe
        if (!job.outputPath) {
            return res.status(500).json({
                success: false,
                error: 'Chemin de fichier manquant'
            });
        }

        const fileStats = await FileService.getFileStats(job.outputPath);
        if (!fileStats) {
            logger.error(`Fichier de sortie introuvable: ${job.outputPath}`, { jobId });
            return res.status(404).json({
                success: false,
                error: 'Fichier non trouvé sur le serveur'
            });
        }

        // Ajouter les informations à la requête
        req.job = job;
        req.fileStats = fileStats;
        
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
 * GET /api/download/:jobId
 * Télécharger le fichier traité
 */
router.get('/:jobId',
    downloadRateLimit,
    validateRequest.jobId,
    validateDownloadAccess,
    async (req, res) => {
        const { jobId } = req.params;
        const { job, fileStats } = req;
        
        const downloadLogger = logger.withContext({
            jobId,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        try {
            downloadLogger.info('Téléchargement démarré', {
                filename: job.originalName,
                outputPath: job.outputPath,
                size: fileStats.size
            });

            // Déterminer le nom de fichier pour le téléchargement
            const originalExt = path.extname(job.originalName);
            const baseName = path.basename(job.originalName, originalExt);
            
            // Ajouter un suffixe pour indiquer la compression
            let downloadFilename;
            if (job.compressionRatio && job.compressionRatio > 0) {
                downloadFilename = `${baseName}_optimized${originalExt}`;
            } else {
                downloadFilename = job.originalName;
            }

            // Nettoyer le nom de fichier pour le téléchargement
            downloadFilename = ValidationService.sanitizeFilename(downloadFilename) || 'file';

            // Déterminer le type MIME
            const mimeType = require('mime-types').lookup(job.outputPath) || 'application/octet-stream';

            // Configurer les headers de réponse
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', fileStats.size);
            res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            
            // Headers personnalisés avec informations sur le traitement
            res.setHeader('X-Original-Size', job.size);
            res.setHeader('X-Compressed-Size', job.compressedSize || job.size);
            res.setHeader('X-Compression-Ratio', job.compressionRatio || 0);
            res.setHeader('X-File-Type', job.type);
            res.setHeader('X-Processing-Time', new Date(job.updatedAt) - new Date(job.createdAt));

            // Support du Range (téléchargement partiel)
            const range = req.headers.range;
            
            if (range) {
                const ranges = parseRange(fileStats.size, range);
                
                if (ranges && ranges.length === 1 && ranges[0].start < fileStats.size) {
                    const { start, end } = ranges[0];
                    const contentLength = (end - start) + 1;
                    
                    res.status(206); // Partial Content
                    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileStats.size}`);
                    res.setHeader('Content-Length', contentLength);
                    res.setHeader('Accept-Ranges', 'bytes');
                    
                    // Stream partiel
                    const stream = fs.createReadStream(job.outputPath, { start, end });
                    streamFile(stream, res, downloadLogger, job, true);
                } else {
                    // Range invalide
                    res.status(416); // Range Not Satisfiable
                    res.setHeader('Content-Range', `bytes */${fileStats.size}`);
                    res.end();
                }
            } else {
                // Téléchargement complet
                res.setHeader('Accept-Ranges', 'bytes');
                const stream = fs.createReadStream(job.outputPath);
                streamFile(stream, res, downloadLogger, job, false);
            }

        } catch (error) {
            downloadLogger.error('Erreur téléchargement:', error);
            
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
 * GET /api/download/:jobId/info
 * Informations sur le fichier à télécharger
 */
router.get('/:jobId/info',
    downloadRateLimit,
    validateRequest.jobId,
    validateDownloadAccess,
    async (req, res) => {
        try {
            const { job, fileStats } = req;
            
            // Calculer les métriques
            const compressionRatio = parseInt(job.compressionRatio) || 0;
            const savedBytes = parseInt(job.size) - parseInt(job.compressedSize || job.size);
            const processingTime = new Date(job.updatedAt) - new Date(job.createdAt);

            res.json({
                success: true,
                file: {
                    jobId: job.id,
                    originalName: job.originalName,
                    type: job.type,
                    originalSize: parseInt(job.size),
                    originalSizeFormatted: FileService.formatFileSize(parseInt(job.size)),
                    compressedSize: parseInt(job.compressedSize || job.size),
                    compressedSizeFormatted: FileService.formatFileSize(parseInt(job.compressedSize || job.size)),
                    compressionRatio,
                    savedBytes,
                    savedBytesFormatted: FileService.formatFileSize(savedBytes),
                    processingTime: Math.floor(processingTime / 1000), // en secondes
                    mimeType: require('mime-types').lookup(job.outputPath) || 'application/octet-stream',
                    settings: job.settings,
                    createdAt: job.createdAt,
                    completedAt: job.updatedAt
                }
            });

        } catch (error) {
            logger.error('Erreur info download:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur récupération informations'
            });
        }
    }
);

/**
 * GET /api/download/:jobId/preview
 * Prévisualisation du fichier (pour les images)
 */
router.get('/:jobId/preview',
    downloadRateLimit,
    validateRequest.jobId,
    validateDownloadAccess,
    async (req, res) => {
        try {
            const { job } = req;
            
            // Vérifier que c'est une image
            if (job.type !== 'image') {
                return res.status(400).json({
                    success: false,
                    error: 'Prévisualisation disponible uniquement pour les images'
                });
            }

            const { size = 'medium' } = req.query;
            const maxSizes = {
                small: 150,
                medium: 300,
                large: 600
            };

            const maxSize = maxSizes[size] || 300;

            // Générer une vignette temporaire
            const ImageService = require('../services/imageService');
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            const thumbnailPath = path.join(tempDir, `preview_${job.id}_${maxSize}.jpg`);

            // Vérifier si la vignette existe déjà
            let thumbExists = await FileService.getFileStats(thumbnailPath);
            
            if (!thumbExists) {
                // Créer la vignette
                await ImageService.createThumbnail(job.outputPath, thumbnailPath, maxSize);
                thumbExists = await FileService.getFileStats(thumbnailPath);
            }

            if (!thumbExists) {
                return res.status(500).json({
                    success: false,
                    error: 'Impossible de générer la prévisualisation'
                });
            }

            // Servir la vignette
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Length', thumbExists.size);
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1h
            
            const stream = fs.createReadStream(thumbnailPath);
            stream.pipe(res);

            // Nettoyer la vignette après envoi (optionnel)
            stream.on('end', () => {
                setTimeout(() => {
                    FileService.deleteFile(thumbnailPath).catch(() => {});
                }, 5000); // Attendre 5s avant suppression
            });

        } catch (error) {
            logger.error('Erreur preview:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur génération prévisualisation'
            });
        }
    }
);

/**
 * Fonction pour streamer un fichier avec gestion d'erreurs
 */
function streamFile(stream, res, downloadLogger, job, isPartial = false) {
    let bytesStreamed = 0;
    const startTime = Date.now();

    stream.on('data', (chunk) => {
        bytesStreamed += chunk.length;
    });

    stream.on('end', () => {
        const duration = Date.now() - startTime;
        const speed = bytesStreamed / (duration / 1000); // bytes/sec
        
        downloadLogger.info('Téléchargement terminé', {
            bytesStreamed,
            duration,
            speedBps: Math.round(speed),
            speedFormatted: FileService.formatFileSize(speed) + '/s',
            isPartial
        });

        downloadLogger.metric('download_completed', 1, 'count', {
            jobId: job.id,
            fileType: job.type,
            size: bytesStreamed
        });
    });

    stream.on('error', (error) => {
        downloadLogger.error('Erreur stream fichier:', error);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Erreur lecture fichier'
            });
        }
    });

    res.on('close', () => {
        // Client a fermé la connexion
        downloadLogger.info('Connexion fermée par le client', {
            bytesStreamed,
            isComplete: res.writableEnded
        });
        
        // Nettoyer le stream
        if (stream.readable) {
            stream.destroy();
        }
    });

    // Pipe le stream vers la réponse
    stream.pipe(res);
}

/**
 * Parser les headers Range pour le download partiel
 */
function parseRange(size, rangeHeader) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }

    const ranges = [];
    const rangeSpecs = rangeHeader.substring(6).split(',');

    for (const rangeSpec of rangeSpecs) {
        const rangeParts = rangeSpec.trim().split('-');
        
        if (rangeParts.length !== 2) continue;

        let start = parseInt(rangeParts[0]) || 0;
        let end = parseInt(rangeParts[1]) || (size - 1);

        // Validation
        if (start < 0) start = 0;
        if (end >= size) end = size - 1;
        if (start > end) continue;

        ranges.push({ start, end });
    }

    return ranges.length > 0 ? ranges : null;
}

module.exports = router;