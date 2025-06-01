// backend/src/routes/upload.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const FileService = require('../services/fileService');
const JobService = require('../services/jobService');
const ProcessingService = require('../services/processingService');
const { ValidationService } = require('../utils/validation');
const logger = require('../utils/logger');
const { addJobToQueue } = require('../services/queueService');

const router = express.Router();

/**
 * Configuration de Multer pour l'upload de fichiers
 */
const uploadConfig = multer({
    storage: multer.memoryStorage(), // Stockage en mémoire pour validation
    limits: {
        fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 * 1024, // 5GB par défaut
        files: 1, // Un seul fichier à la fois
        fields: 10, // Limite des champs supplémentaires
        fieldNameSize: 100, // Limite nom de champ
        fieldSize: 1024 * 1024 // 1MB pour les champs texte
    },
    fileFilter: (req, file, cb) => {
        // Validation préliminaire du fichier
        const isValidType = FileService.isValidFileType(file.originalname);
        
        if (!isValidType) {
            logger.security('Tentative upload type invalide', {
                filename: file.originalname,
                mimetype: file.mimetype,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return cb(new Error('Type de fichier non supporté'), false);
        }
        
        cb(null, true);
    }
});

/**
 * Rate limiting spécifique aux uploads
 */
const uploadRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.UPLOAD_RATE_LIMIT) || 10, // 10 uploads par 15min
    message: {
        success: false,
        error: 'Trop d\'uploads, veuillez attendre avant de réessayer',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Rate limit par IP + User-Agent pour éviter les contournements
        return `${req.ip}-${req.get('User-Agent') || 'unknown'}`;
    },
    skip: (req) => {
        // Skip rate limiting en développement si configuré
        return process.env.NODE_ENV === 'development' && 
               process.env.SKIP_RATE_LIMIT === 'true';
    },
    onLimitReached: (req) => {
        logger.security('Rate limit upload atteint', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path
        });
    }
});

/**
 * Middleware de validation de sécurité upload
 */
const securityValidation = async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({
                success: false,
                error: 'Aucun fichier fourni'
            });
        }

        // Validation de sécurité avancée
        const securityCheck = ValidationService.validateUploadSecurity(file, req);
        if (!securityCheck.isValid) {
            logger.security('Upload bloqué par sécurité', {
                filename: file.originalname,
                errors: securityCheck.errors,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            
            return res.status(400).json({
                success: false,
                error: 'Fichier rejeté par les contrôles de sécurité',
                details: securityCheck.errors
            });
        }

        next();
    } catch (error) {
        logger.error('Erreur validation sécurité upload:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne de validation'
        });
    }
};

/**
 * POST /api/upload
 * Upload d'un fichier avec validation complète
 */
router.post('/', 
    uploadRateLimit,
    uploadConfig.single('file'),
    securityValidation,
    async (req, res) => {
        const requestLogger = logger.withContext({ 
            requestId: uuidv4(),
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        try {
            const file = req.file;
            const settings = req.body.settings ? JSON.parse(req.body.settings) : {};

            requestLogger.info('Upload démarré', {
                filename: file.originalname,
                size: file.size,
                mimetype: file.mimetype
            });

            // Validation complète du fichier et des paramètres
            const validation = await ValidationService.validateUpload(file, settings);
            if (!validation.isValid) {
                requestLogger.warn('Validation upload échouée', {
                    errors: validation.errors
                });
                
                return res.status(400).json({
                    success: false,
                    error: 'Fichier ou paramètres invalides',
                    details: validation.errors
                });
            }

            // Nettoyer le nom de fichier
            const sanitizedFilename = ValidationService.sanitizeFilename(file.originalname);
            if (!sanitizedFilename) {
                return res.status(400).json({
                    success: false,
                    error: 'Nom de fichier invalide'
                });
            }

            // Créer le répertoire temporaire
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            await FileService.ensureDirectoryExists(tempDir);

            // Générer un nom de fichier unique
            const uniqueFilename = FileService.generateUniqueFilename(sanitizedFilename);
            const filePath = path.join(tempDir, uniqueFilename);

            // Sauvegarder le fichier
            const fs = require('fs').promises;
            await fs.writeFile(filePath, file.buffer);

            requestLogger.info('Fichier sauvegardé', { filePath });

            // Obtenir les paramètres validés avec valeurs par défaut
            const fileType = FileService.getFileType(sanitizedFilename);
            const defaultSettings = ProcessingService.getDefaultSettings(fileType);
            const finalSettings = { ...defaultSettings, ...validation.validatedData.settings };

            // Valider les paramètres finaux
            const settingsValidation = ValidationService.validateSettings(fileType, finalSettings);
            if (!settingsValidation.isValid) {
                // Nettoyer le fichier en cas d'erreur
                await FileService.deleteFile(filePath);
                
                return res.status(400).json({
                    success: false,
                    error: 'Paramètres invalides',
                    details: settingsValidation.errors
                });
            }

            // Créer le job
            const jobId = uuidv4();
            const jobData = {
                id: jobId,
                originalName: sanitizedFilename,
                filePath,
                size: file.size,
                type: fileType,
                settings: settingsValidation.validatedSettings,
                status: 'uploaded',
                progress: 0,
                createdAt: new Date().toISOString()
            };

            // Validation finale du job
            const jobValidation = ValidationService.validateJob(jobData);
            if (!jobValidation.isValid) {
                await FileService.deleteFile(filePath);
                
                return res.status(400).json({
                    success: false,
                    error: 'Job invalide',
                    details: jobValidation.errors
                });
            }

            // Sauvegarder le job
            await JobService.createJob(jobValidation.validatedJob);

            requestLogger.job(jobId, 'Job créé avec succès');

            // Estimer le temps de traitement
            const estimatedTime = ProcessingService.estimateProcessingTime(fileType, file.size);

            // Réponse immédiate
            res.status(201).json({
                success: true,
                jobId,
                message: 'Fichier uploadé avec succès',
                file: {
                    originalName: sanitizedFilename,
                    size: file.size,
                    sizeFormatted: FileService.formatFileSize(file.size),
                    type: fileType
                },
                settings: settingsValidation.validatedSettings,
                estimatedTime,
                status: 'uploaded'
            });

            // Ajouter à la queue de traitement (asynchrone)
            setImmediate(async () => {
                try {
                    await addJobToQueue(jobValidation.validatedJob);
                    await JobService.updateJob(jobId, { status: 'queued' });
                    
                    requestLogger.job(jobId, 'Job ajouté à la queue');
                    
                    // Notifier via WebSocket si disponible
                    if (req.io) {
                        req.io.emit('job-queued', {
                            jobId,
                            status: 'queued',
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    requestLogger.error('Erreur ajout queue', error, { jobId });
                    
                    await JobService.updateJob(jobId, { 
                        status: 'error',
                        error: 'Erreur ajout à la queue'
                    });
                }
            });

        } catch (error) {
            requestLogger.error('Erreur upload:', error);
            
            // Nettoyer le fichier en cas d'erreur
            if (req.file && req.filePath) {
                await FileService.deleteFile(req.filePath).catch(() => {});
            }

            res.status(500).json({
                success: false,
                error: 'Erreur interne du serveur',
                message: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

/**
 * POST /api/upload/batch
 * Upload de plusieurs fichiers (limité)
 */
router.post('/batch',
    uploadRateLimit,
    uploadConfig.array('files', 5), // Maximum 5 fichiers
    async (req, res) => {
        const requestLogger = logger.withContext({ 
            requestId: uuidv4(),
            ip: req.ip
        });

        try {
            const files = req.files;
            if (!files || files.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Aucun fichier fourni'
                });
            }

            requestLogger.info('Upload batch démarré', {
                fileCount: files.length,
                totalSize: files.reduce((sum, f) => sum + f.size, 0)
            });

            const results = [];
            const errors = [];

            // Traiter chaque fichier
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                
                try {
                    // Simulation de l'upload individuel
                    // (logique similaire à l'upload simple)
                    const jobId = uuidv4();
                    const sanitizedFilename = ValidationService.sanitizeFilename(file.originalname);
                    
                    if (!sanitizedFilename) {
                        errors.push({
                            file: file.originalname,
                            error: 'Nom de fichier invalide'
                        });
                        continue;
                    }

                    results.push({
                        jobId,
                        filename: sanitizedFilename,
                        size: file.size,
                        status: 'uploaded'
                    });

                } catch (error) {
                    errors.push({
                        file: file.originalname,
                        error: error.message
                    });
                }
            }

            res.json({
                success: true,
                message: `${results.length} fichiers traités`,
                results,
                errors: errors.length > 0 ? errors : undefined,
                total: files.length,
                processed: results.length,
                failed: errors.length
            });

        } catch (error) {
            requestLogger.error('Erreur upload batch:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur traitement batch'
            });
        }
    }
);

/**
 * GET /api/upload/info
 * Informations sur les limites d'upload
 */
router.get('/info', (req, res) => {
    res.json({
        success: true,
        limits: {
            maxFileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 * 1024,
            maxFileSizeFormatted: FileService.formatFileSize(
                parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 * 1024
            ),
            maxFiles: 1,
            maxFilesBatch: 5,
            rateLimit: parseInt(process.env.UPLOAD_RATE_LIMIT) || 10,
            rateLimitWindow: '15 minutes'
        },
        supportedFormats: FileService.getSupportedFormats(),
        defaultSettings: {
            image: ProcessingService.getDefaultSettings('image'),
            video: ProcessingService.getDefaultSettings('video'),
            audio: ProcessingService.getDefaultSettings('audio'),
            document: ProcessingService.getDefaultSettings('document')
        }
    });
});

/**
 * Middleware de gestion d'erreurs Multer
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        logger.warn('Erreur Multer:', {
            code: error.code,
            field: error.field,
            message: error.message,
            ip: req.ip
        });

        const errorMessages = {
            'LIMIT_FILE_SIZE': 'Fichier trop volumineux',
            'LIMIT_FILE_COUNT': 'Trop de fichiers',
            'LIMIT_FIELD_KEY': 'Nom de champ trop long',
            'LIMIT_FIELD_VALUE': 'Valeur de champ trop longue',
            'LIMIT_FIELD_COUNT': 'Trop de champs',
            'LIMIT_UNEXPECTED_FILE': 'Fichier inattendu'
        };

        return res.status(400).json({
            success: false,
            error: errorMessages[error.code] || 'Erreur upload',
            code: error.code
        });
    }

    if (error.message === 'Type de fichier non supporté') {
        return res.status(400).json({
            success: false,
            error: 'Type de fichier non supporté'
        });
    }

    logger.error('Erreur route upload:', error);
    res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
    });
});

module.exports = router;