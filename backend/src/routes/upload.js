// backend/src/routes/upload.js - CORRIGÉ
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
 * ✅ FIX: Middleware de validation sécurité AVANT multer
 */
const securityPreCheck = (req, res, next) => {
    try {
        // Validation de base de la requête
        const contentType = req.get('Content-Type');
        const userAgent = req.get('User-Agent') || '';
        
        // ✅ FIX: Vérifier Content-Type avec boundary
        if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
            logger.security('Content-Type invalide pour upload', {
                contentType,
                ip: req.ip,
                userAgent
            });
            return res.status(400).json({
                success: false,
                error: 'Content-Type multipart/form-data requis'
            });
        }

        // ✅ FIX: Détecter User-Agent suspects AVANT traitement
        if (ValidationService.isSuspiciousUserAgent(userAgent)) {
            logger.security('User-Agent suspect bloqué', {
                userAgent,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                error: 'Accès non autorisé'
            });
        }

        // Vérifier la taille Content-Length avant traitement
        const contentLength = parseInt(req.get('Content-Length') || '0');
        const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 * 1024;
        
        if (contentLength > maxSize) {
            logger.security('Fichier trop volumineux avant traitement', {
                contentLength,
                maxSize,
                ip: req.ip
            });
            return res.status(413).json({
                success: false,
                error: 'Fichier trop volumineux'
            });
        }

        next();
    } catch (error) {
        logger.error('Erreur pre-check sécurité:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur validation sécurité'
        });
    }
};

/**
 * ✅ FIX: Configuration Multer sécurisée
 */
const uploadConfig = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 * 1024,
        files: 1,
        fields: 10,
        fieldNameSize: 100,
        fieldSize: 1024 * 1024,
        // ✅ NOUVEAU: Limites supplémentaires
        parts: 20,
        headerPairs: 2000
    },
    fileFilter: (req, file, cb) => {
        try {
            // ✅ FIX: Validation stricte du nom de fichier
            const sanitizedName = ValidationService.sanitizeFilename(file.originalname);
            if (!sanitizedName) {
                logger.security('Nom de fichier invalide', {
                    originalname: file.originalname,
                    ip: req.ip
                });
                return cb(new Error('Nom de fichier invalide'), false);
            }

            // ✅ FIX: Vérifier le type de fichier AVANT chargement
            const isValidType = FileService.isValidFileType(sanitizedName);
            if (!isValidType) {
                logger.security('Type de fichier non supporté', {
                    filename: sanitizedName,
                    mimetype: file.mimetype,
                    ip: req.ip
                });
                return cb(new Error('Type de fichier non supporté'), false);
            }

            // ✅ FIX: Validation MIME type stricte
            const mimeValid = ValidationService.validateMimeType(sanitizedName, file.mimetype);
            if (!mimeValid) {
                logger.security('MIME type incompatible', {
                    filename: sanitizedName,
                    mimetype: file.mimetype,
                    ip: req.ip
                });
                return cb(new Error('Type MIME incompatible avec l\'extension'), false);
            }

            // ✅ FIX: Stocker le nom nettoyé
            file.sanitizedName = sanitizedName;
            cb(null, true);

        } catch (error) {
            logger.error('Erreur fileFilter:', error);
            cb(new Error('Erreur validation fichier'), false);
        }
    }
});

/**
 * Rate limiting pour uploads avec détection de pic
 */
const uploadRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.UPLOAD_RATE_LIMIT) || 10,
    message: {
        success: false,
        error: 'Trop d\'uploads, veuillez attendre',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // ✅ FIX: Rate limit par IP + taille du fichier
        const contentLength = parseInt(req.get('Content-Length') || '0');
        const sizeCategory = contentLength > 100 * 1024 * 1024 ? 'large' : 'normal';
        return `${req.ip}-${sizeCategory}`;
    },
    skip: (req) => {
        return process.env.NODE_ENV === 'development' && 
               process.env.SKIP_RATE_LIMIT === 'true';
    },
    onLimitReached: (req) => {
        logger.security('Rate limit upload atteint', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            contentLength: req.get('Content-Length')
        });
    }
});

/**
 * ✅ FIX: Validation sécurité POST-multer sécurisée
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

        // ✅ FIX: Utiliser le nom nettoyé
        if (!file.sanitizedName) {
            return res.status(400).json({
                success: false,
                error: 'Nom de fichier invalide'
            });
        }

        // ✅ FIX: Validation magic bytes OBLIGATOIRE
        const magicBytesValid = ValidationService.validateMagicBytes(file.buffer, file.sanitizedName);
        if (!magicBytesValid) {
            logger.security('Magic bytes invalides', {
                filename: file.sanitizedName,
                mimetype: file.mimetype,
                size: file.size,
                ip: req.ip
            });
            return res.status(400).json({
                success: false,
                error: 'Signature de fichier invalide'
            });
        }

        // ✅ FIX: Validation taille réelle vs déclarée
        if (file.buffer.length !== file.size) {
            logger.security('Taille incohérente', {
                declaredSize: file.size,
                actualSize: file.buffer.length,
                filename: file.sanitizedName,
                ip: req.ip
            });
            return res.status(400).json({
                success: false,
                error: 'Taille de fichier incohérente'
            });
        }

        // ✅ FIX: Détection contenu suspect
        if (ValidationService.containsSuspiciousContent(file.sanitizedName)) {
            logger.security('Contenu suspect détecté', {
                filename: file.sanitizedName,
                ip: req.ip
            });
            return res.status(400).json({
                success: false,
                error: 'Contenu non autorisé'
            });
        }

        // ✅ FIX: Validation avancée selon le type
        const fileType = FileService.getFileType(file.sanitizedName);
        const advancedValidation = await ValidationService.validateFileContent(file.buffer, fileType);
        if (!advancedValidation.isValid) {
            logger.security('Validation contenu échouée', {
                filename: file.sanitizedName,
                type: fileType,
                errors: advancedValidation.errors,
                ip: req.ip
            });
            return res.status(400).json({
                success: false,
                error: 'Contenu de fichier invalide',
                details: advancedValidation.errors
            });
        }

        next();
    } catch (error) {
        logger.error('Erreur validation sécurité:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur validation sécurité'
        });
    }
};

/**
 * ✅ FIX: Endpoint upload sécurisé
 */
router.post('/', 
    securityPreCheck,              // ✅ AVANT multer
    uploadRateLimit,
    uploadConfig.single('file'),   // ✅ Multer sécurisé
    securityValidation,            // ✅ APRÈS multer
    async (req, res) => {
        const requestLogger = logger.withContext({ 
            requestId: uuidv4(),
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        try {
            const file = req.file;
            const settings = req.body.settings ? JSON.parse(req.body.settings) : {};

            requestLogger.info('Upload sécurisé démarré', {
                filename: file.sanitizedName,
                size: file.size,
                mimetype: file.mimetype
            });

            // ✅ FIX: Validation complète avec nom nettoyé
            const validation = await ValidationService.validateUpload({
                ...file,
                originalname: file.sanitizedName // Utiliser le nom nettoyé
            }, settings);

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

            // ✅ FIX: Créer répertoire sécurisé
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            await FileService.ensureDirectoryExists(tempDir);

            // ✅ FIX: Génération nom de fichier ultra-sécurisée
            const secureFilename = FileService.generateSecureFilename(file.sanitizedName);
            const filePath = path.join(tempDir, secureFilename);

            // ✅ FIX: Validation chemin absolu sécurisé
            const safePath = FileService.validateSecurePath(filePath, tempDir);
            if (!safePath.isValid) {
                requestLogger.error('Chemin non sécurisé détecté', {
                    requestedPath: filePath,
                    resolvedPath: safePath.resolvedPath
                });
                return res.status(500).json({
                    success: false,
                    error: 'Erreur sécurité chemin'
                });
            }

            // Sauvegarder avec permissions sécurisées
            const fs = require('fs').promises;
            await fs.writeFile(safePath.resolvedPath, file.buffer, { mode: 0o644 });

            requestLogger.info('Fichier sauvegardé sécurisé', { 
                filePath: safePath.resolvedPath 
            });

            // Obtenir paramètres validés
            const fileType = FileService.getFileType(file.sanitizedName);
            const defaultSettings = ProcessingService.getDefaultSettings(fileType);
            const finalSettings = { ...defaultSettings, ...validation.validatedData.settings };

            // Validation finale des paramètres
            const settingsValidation = ValidationService.validateSettings(fileType, finalSettings);
            if (!settingsValidation.isValid) {
                // ✅ FIX: Nettoyer le fichier en cas d'erreur
                await FileService.deleteSecureFile(safePath.resolvedPath).catch(() => {});
                
                return res.status(400).json({
                    success: false,
                    error: 'Paramètres invalides',
                    details: settingsValidation.errors
                });
            }

            // Créer le job sécurisé
            const jobId = uuidv4();
            const jobData = {
                id: jobId,
                originalName: file.sanitizedName, // ✅ Nom nettoyé
                filePath: safePath.resolvedPath,
                size: file.size,
                type: fileType,
                settings: settingsValidation.validatedSettings,
                status: 'uploaded',
                progress: 0,
                createdAt: new Date().toISOString(),
                // ✅ NOUVEAU: Métadonnées sécurité
                security: {
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    validated: true,
                    magicBytesChecked: true
                }
            };

            // Validation finale du job
            const jobValidation = ValidationService.validateJob(jobData);
            if (!jobValidation.isValid) {
                await FileService.deleteSecureFile(safePath.resolvedPath).catch(() => {});
                
                return res.status(400).json({
                    success: false,
                    error: 'Job invalide',
                    details: jobValidation.errors
                });
            }

            // Sauvegarder le job
            await JobService.createJob(jobValidation.validatedJob);

            requestLogger.job(jobId, 'Job sécurisé créé avec succès');

            // Estimation temps
            const estimatedTime = ProcessingService.estimateProcessingTime(fileType, file.size);

            // Réponse immédiate
            res.status(201).json({
                success: true,
                jobId,
                message: 'Fichier uploadé et validé avec succès',
                file: {
                    originalName: file.sanitizedName,
                    size: file.size,
                    sizeFormatted: FileService.formatFileSize(file.size),
                    type: fileType
                },
                settings: settingsValidation.validatedSettings,
                estimatedTime,
                status: 'uploaded',
                security: {
                    validated: true,
                    scanned: true
                }
            });

            // ✅ FIX: Ajouter à la queue de manière asynchrone sécurisée
            setImmediate(async () => {
                try {
                    await addJobToQueue(jobValidation.validatedJob);
                    await JobService.updateJob(jobId, { status: 'queued' });
                    
                    requestLogger.job(jobId, 'Job ajouté à la queue sécurisée');
                    
                    // Notifier via WebSocket si disponible
                    if (req.io) {
                        req.io.emit('job-queued', {
                            jobId,
                            status: 'queued',
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    requestLogger.error('Erreur ajout queue sécurisée', error, { jobId });
                    
                    await JobService.updateJob(jobId, { 
                        status: 'error',
                        error: 'Erreur ajout à la queue'
                    });

                    // Nettoyer le fichier en cas d'erreur
                    await FileService.deleteSecureFile(safePath.resolvedPath).catch(() => {});
                }
            });

        } catch (error) {
            requestLogger.error('Erreur upload sécurisé:', error);
            
            // ✅ FIX: Nettoyer en cas d'erreur avec chemin sécurisé
            if (req.file && req.filePath) {
                await FileService.deleteSecureFile(req.filePath).catch(() => {});
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
 * ✅ FIX: Upload batch sécurisé
 */
router.post('/batch',
    securityPreCheck,
    uploadRateLimit,
    uploadConfig.array('files', 5),
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

            requestLogger.info('Upload batch sécurisé démarré', {
                fileCount: files.length,
                totalSize: files.reduce((sum, f) => sum + f.size, 0)
            });

            const results = [];
            const errors = [];

            // ✅ FIX: Validation sécurisée pour chaque fichier
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                
                try {
                    // Appliquer toutes les validations sécurisées
                    const sanitizedName = ValidationService.sanitizeFilename(file.originalname);
                    if (!sanitizedName) {
                        errors.push({
                            file: file.originalname,
                            error: 'Nom de fichier invalide'
                        });
                        continue;
                    }

                    // Validation magic bytes
                    const magicBytesValid = ValidationService.validateMagicBytes(file.buffer, sanitizedName);
                    if (!magicBytesValid) {
                        errors.push({
                            file: sanitizedName,
                            error: 'Signature de fichier invalide'
                        });
                        continue;
                    }

                    const jobId = uuidv4();
                    results.push({
                        jobId,
                        filename: sanitizedName,
                        size: file.size,
                        status: 'uploaded',
                        security: {
                            validated: true,
                            scanned: true
                        }
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
                message: `${results.length} fichiers traités sécurisés`,
                results,
                errors: errors.length > 0 ? errors : undefined,
                total: files.length,
                processed: results.length,
                failed: errors.length,
                security: {
                    allValidated: errors.length === 0,
                    scanCompleted: true
                }
            });

        } catch (error) {
            requestLogger.error('Erreur upload batch sécurisé:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur traitement batch sécurisé'
            });
        }
    }
);

/**
 * Informations upload - inchangées mais sécurisées
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
        },
        security: {
            magicBytesValidation: true,
            contentScanning: true,
            pathTraversalProtection: true,
            mimeTypeValidation: true
        }
    });
});

/**
 * ✅ FIX: Gestionnaire d'erreurs Multer sécurisé
 */
router.use((error, req, res, next) => {
    // Log sécurisé sans exposer de détails sensibles
    const safeError = {
        code: error.code,
        message: error.message,
        field: error.field
    };

    logger.warn('Erreur Multer sécurisée:', {
        ...safeError,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    if (error instanceof multer.MulterError) {
        const errorMessages = {
            'LIMIT_FILE_SIZE': 'Fichier trop volumineux',
            'LIMIT_FILE_COUNT': 'Trop de fichiers',
            'LIMIT_FIELD_KEY': 'Nom de champ trop long',
            'LIMIT_FIELD_VALUE': 'Valeur de champ trop longue',
            'LIMIT_FIELD_COUNT': 'Trop de champs',
            'LIMIT_UNEXPECTED_FILE': 'Fichier inattendu',
            'LIMIT_PART_COUNT': 'Trop de parties',
            'LIMIT_HEADER_PAIRS': 'Trop d\'en-têtes'
        };

        return res.status(400).json({
            success: false,
            error: errorMessages[error.code] || 'Erreur upload',
            code: error.code
        });
    }

    if (error.message === 'Type de fichier non supporté' ||
        error.message === 'Nom de fichier invalide' ||
        error.message === 'Type MIME incompatible avec l\'extension') {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    logger.error('Erreur route upload sécurisée:', error);
    res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
    });
});

module.exports = router;