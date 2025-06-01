// backend/src/utils/validation.js
const Joi = require('joi');
const FileService = require('../services/fileService');
const logger = require('./logger');

/**
 * Schémas de validation avec Joi
 */
class ValidationSchemas {
    /**
     * Validation des paramètres d'upload
     */
    static uploadSchema = Joi.object({
        file: Joi.object({
            originalname: Joi.string().required(),
            mimetype: Joi.string().required(),
            size: Joi.number().min(1).max(5 * 1024 * 1024 * 1024).required(), // 5GB max
            buffer: Joi.binary().required()
        }).required(),
        settings: Joi.object().optional()
    });

    /**
     * Validation des paramètres d'image
     */
    static imageSettingsSchema = Joi.object({
        quality: Joi.number().min(1).max(100).default(80),
        maxWidth: Joi.number().min(100).max(8000).default(1920),
        maxHeight: Joi.number().min(100).max(8000).default(1080),
        format: Joi.string().valid('auto', 'jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff').default('auto'),
        removeMetadata: Joi.boolean().default(true),
        progressive: Joi.boolean().default(true)
    });

    /**
     * Validation des paramètres de vidéo
     */
    static videoSettingsSchema = Joi.object({
        codec: Joi.string().valid('h264', 'h265', 'vp9', 'av1').default('h264'),
        crf: Joi.number().min(18).max(51).default(23),
        preset: Joi.string().valid('ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow').default('medium'),
        maxBitrate: Joi.string().regex(/^\d+[KMG]?$/).default('2M'),
        fps: Joi.number().min(1).max(60).optional(),
        resolution: Joi.string().valid('480p', '720p', '1080p', '1440p', '4K').optional()
    });

    /**
     * Validation des paramètres d'audio
     */
    static audioSettingsSchema = Joi.object({
        codec: Joi.string().valid('aac', 'mp3', 'ogg', 'flac').default('aac'),
        bitrate: Joi.string().regex(/^\d+[k]?$/).default('128k'),
        sampleRate: Joi.number().valid(22050, 44100, 48000, 96000).default(44100),
        channels: Joi.number().valid(1, 2).default(2),
        normalize: Joi.boolean().default(false)
    });

    /**
     * Validation des paramètres de document
     */
    static documentSettingsSchema = Joi.object({
        compress: Joi.boolean().default(true),
        removeMetadata: Joi.boolean().default(true),
        quality: Joi.number().min(1).max(100).default(80),
        optimizeImages: Joi.boolean().default(true)
    });

    /**
     * Validation d'un job
     */
    static jobSchema = Joi.object({
        id: Joi.string().uuid().required(),
        originalName: Joi.string().min(1).max(255).required(),
        filePath: Joi.string().required(),
        size: Joi.number().min(1).required(),
        type: Joi.string().valid('image', 'video', 'audio', 'document').required(),
        settings: Joi.object().required(),
        status: Joi.string().valid('uploaded', 'queued', 'processing', 'completed', 'error').default('uploaded'),
        progress: Joi.number().min(0).max(100).default(0),
        createdAt: Joi.date().iso().default(() => new Date()),
        updatedAt: Joi.date().iso().default(() => new Date())
    });

    /**
     * Validation des paramètres de pagination
     */
    static paginationSchema = Joi.object({
        page: Joi.number().min(1).default(1),
        limit: Joi.number().min(1).max(100).default(20),
        sortBy: Joi.string().valid('createdAt', 'updatedAt', 'size', 'status').default('createdAt'),
        sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    });

    /**
     * Validation des filtres de jobs
     */
    static jobFiltersSchema = Joi.object({
        status: Joi.string().valid('uploaded', 'queued', 'processing', 'completed', 'error').optional(),
        type: Joi.string().valid('image', 'video', 'audio', 'document').optional(),
        dateFrom: Joi.date().iso().optional(),
        dateTo: Joi.date().iso().optional(),
        minSize: Joi.number().min(0).optional(),
        maxSize: Joi.number().min(0).optional()
    });

    /**
     * Validation d'un ID de job
     */
    static jobIdSchema = Joi.string().uuid().required();

    /**
     * Validation des paramètres de health check
     */
    static healthCheckSchema = Joi.object({
        includeMetrics: Joi.boolean().default(false),
        includeRedis: Joi.boolean().default(true),
        includeQueue: Joi.boolean().default(true)
    });
}

/**
 * Service de validation
 */
class ValidationService {
    /**
     * Valider un fichier uploadé
     */
    static async validateUpload(file, settings = {}) {
        try {
            // Validation de base
            const { error: baseError, value: validatedData } = ValidationSchemas.uploadSchema.validate({
                file,
                settings
            });

            if (baseError) {
                return {
                    isValid: false,
                    errors: baseError.details.map(detail => detail.message)
                };
            }

            const errors = [];

            // Vérification du type de fichier
            const fileType = FileService.getFileType(file.originalname);
            if (fileType === 'unknown') {
                errors.push('Type de fichier non supporté');
            }

            // Vérification de l'extension vs MIME type
            if (!this.validateMimeType(file.originalname, file.mimetype)) {
                errors.push('Extension de fichier et type MIME incompatibles');
            }

            // Validation des paramètres selon le type
            if (fileType !== 'unknown') {
                const settingsValidation = this.validateSettings(fileType, settings);
                if (!settingsValidation.isValid) {
                    errors.push(...settingsValidation.errors);
                }
            }

            // Vérification de la taille selon le type
            const maxSizeValidation = this.validateFileSize(fileType, file.size);
            if (!maxSizeValidation.isValid) {
                errors.push(maxSizeValidation.error);
            }

            return {
                isValid: errors.length === 0,
                errors,
                validatedData: errors.length === 0 ? validatedData : null,
                fileType
            };

        } catch (error) {
            logger.error('Erreur validation upload:', error);
            return {
                isValid: false,
                errors: ['Erreur interne de validation']
            };
        }
    }

    /**
     * Valider les paramètres selon le type de fichier
     */
    static validateSettings(fileType, settings) {
        try {
            let schema;
            
            switch (fileType) {
                case 'image':
                    schema = ValidationSchemas.imageSettingsSchema;
                    break;
                case 'video':
                    schema = ValidationSchemas.videoSettingsSchema;
                    break;
                case 'audio':
                    schema = ValidationSchemas.audioSettingsSchema;
                    break;
                case 'document':
                    schema = ValidationSchemas.documentSettingsSchema;
                    break;
                default:
                    return { isValid: true, validatedSettings: settings };
            }

            const { error, value } = schema.validate(settings, { allowUnknown: false });
            
            if (error) {
                return {
                    isValid: false,
                    errors: error.details.map(detail => detail.message),
                    validatedSettings: null
                };
            }

            return {
                isValid: true,
                errors: [],
                validatedSettings: value
            };

        } catch (error) {
            logger.error('Erreur validation settings:', error);
            return {
                isValid: false,
                errors: ['Erreur validation des paramètres']
            };
        }
    }

    /**
     * Valider la correspondance entre extension et MIME type
     */
    static validateMimeType(filename, mimetype) {
        const mimeTypeMap = {
            // Images
            '.jpg': ['image/jpeg'],
            '.jpeg': ['image/jpeg'],
            '.png': ['image/png'],
            '.webp': ['image/webp'],
            '.avif': ['image/avif'],
            '.heic': ['image/heic', 'image/heif'],
            '.tiff': ['image/tiff'],
            '.bmp': ['image/bmp'],
            
            // Vidéos
            '.mp4': ['video/mp4'],
            '.avi': ['video/x-msvideo'],
            '.mkv': ['video/x-matroska'],
            '.webm': ['video/webm'],
            '.mov': ['video/quicktime'],
            '.flv': ['video/x-flv'],
            '.m4v': ['video/x-m4v'],
            
            // Audio
            '.mp3': ['audio/mpeg'],
            '.flac': ['audio/flac'],
            '.wav': ['audio/wav', 'audio/wave'],
            '.aac': ['audio/aac'],
            '.ogg': ['audio/ogg'],
            '.m4a': ['audio/mp4', 'audio/x-m4a'],
            '.wma': ['audio/x-ms-wma'],
            
            // Documents
            '.pdf': ['application/pdf']
        };

        const ext = require('path').extname(filename).toLowerCase();
        const allowedMimeTypes = mimeTypeMap[ext];

        if (!allowedMimeTypes) {
            return false; // Extension non supportée
        }

        return allowedMimeTypes.includes(mimetype);
    }

    /**
     * Valider la taille de fichier selon le type
     */
    static validateFileSize(fileType, size) {
        const maxSizes = {
            image: 100 * 1024 * 1024,    // 100MB
            video: 5 * 1024 * 1024 * 1024, // 5GB
            audio: 500 * 1024 * 1024,    // 500MB
            document: 100 * 1024 * 1024  // 100MB
        };

        const maxSize = maxSizes[fileType] || 100 * 1024 * 1024; // 100MB par défaut

        if (size > maxSize) {
            return {
                isValid: false,
                error: `Taille de fichier trop importante (max: ${this.formatFileSize(maxSize)})`
            };
        }

        return { isValid: true };
    }

    /**
     * Valider un job complet
     */
    static validateJob(jobData) {
        try {
            const { error, value } = ValidationSchemas.jobSchema.validate(jobData);
            
            if (error) {
                return {
                    isValid: false,
                    errors: error.details.map(detail => detail.message),
                    validatedJob: null
                };
            }

            return {
                isValid: true,
                errors: [],
                validatedJob: value
            };

        } catch (error) {
            logger.error('Erreur validation job:', error);
            return {
                isValid: false,
                errors: ['Erreur validation du job']
            };
        }
    }

    /**
     * Valider les paramètres de pagination
     */
    static validatePagination(params) {
        try {
            const { error, value } = ValidationSchemas.paginationSchema.validate(params);
            
            if (error) {
                return {
                    isValid: false,
                    errors: error.details.map(detail => detail.message),
                    validatedParams: null
                };
            }

            return {
                isValid: true,
                errors: [],
                validatedParams: value
            };

        } catch (error) {
            logger.error('Erreur validation pagination:', error);
            return {
                isValid: false,
                errors: ['Erreur validation pagination']
            };
        }
    }

    /**
     * Valider les filtres de jobs
     */
    static validateJobFilters(filters) {
        try {
            const { error, value } = ValidationSchemas.jobFiltersSchema.validate(filters);
            
            if (error) {
                return {
                    isValid: false,
                    errors: error.details.map(detail => detail.message),
                    validatedFilters: null
                };
            }

            // Validation additionnelle pour les dates
            if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
                return {
                    isValid: false,
                    errors: ['La date de début doit être antérieure à la date de fin'],
                    validatedFilters: null
                };
            }

            // Validation additionnelle pour les tailles
            if (value.minSize && value.maxSize && value.minSize > value.maxSize) {
                return {
                    isValid: false,
                    errors: ['La taille minimum doit être inférieure à la taille maximum'],
                    validatedFilters: null
                };
            }

            return {
                isValid: true,
                errors: [],
                validatedFilters: value
            };

        } catch (error) {
            logger.error('Erreur validation filtres:', error);
            return {
                isValid: false,
                errors: ['Erreur validation des filtres']
            };
        }
    }

    /**
     * Valider un ID de job
     */
    static validateJobId(jobId) {
        try {
            const { error, value } = ValidationSchemas.jobIdSchema.validate(jobId);
            
            if (error) {
                return {
                    isValid: false,
                    errors: ['ID de job invalide (UUID requis)'],
                    validatedId: null
                };
            }

            return {
                isValid: true,
                errors: [],
                validatedId: value
            };

        } catch (error) {
            logger.error('Erreur validation ID job:', error);
            return {
                isValid: false,
                errors: ['Erreur validation ID']
            };
        }
    }

    /**
     * Valider les paramètres de health check
     */
    static validateHealthCheck(params) {
        try {
            const { error, value } = ValidationSchemas.healthCheckSchema.validate(params);
            
            if (error) {
                return {
                    isValid: false,
                    errors: error.details.map(detail => detail.message),
                    validatedParams: null
                };
            }

            return {
                isValid: true,
                errors: [],
                validatedParams: value
            };

        } catch (error) {
            logger.error('Erreur validation health check:', error);
            return {
                isValid: false,
                errors: ['Erreur validation health check']
            };
        }
    }

    /**
     * Nettoyer et valider un nom de fichier
     */
    static sanitizeFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return null;
        }

        // Supprimer les caractères dangereux
        let cleaned = filename
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Caractères interdits
            .replace(/^\.+/, '_') // Points au début
            .replace(/\.+$/, '') // Points à la fin
            .replace(/\s+/g, '_') // Espaces multiples
            .trim();

        // Limiter la longueur
        if (cleaned.length > 255) {
            const ext = require('path').extname(cleaned);
            const name = require('path').basename(cleaned, ext);
            cleaned = name.substring(0, 255 - ext.length) + ext;
        }

        // Vérifier qu'il reste quelque chose
        if (!cleaned || cleaned === '_') {
            return null;
        }

        return cleaned;
    }

    /**
     * Valider et nettoyer les en-têtes HTTP
     */
    static validateHeaders(headers) {
        const allowedHeaders = [
            'content-type',
            'content-length',
            'authorization',
            'x-requested-with',
            'user-agent'
        ];

        const cleanHeaders = {};
        
        for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            if (allowedHeaders.includes(lowerKey)) {
                cleanHeaders[lowerKey] = value;
            }
        }

        return cleanHeaders;
    }

    /**
     * Formater la taille d'un fichier
     */
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Middleware Express pour validation automatique
     */
    static createValidationMiddleware(schema, property = 'body') {
        return (req, res, next) => {
            const { error, value } = schema.validate(req[property]);
            
            if (error) {
                const errors = error.details.map(detail => detail.message);
                logger.security(`Validation failed: ${errors.join(', ')}`, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    path: req.path
                });
                
                return res.status(400).json({
                    success: false,
                    error: 'Données invalides',
                    details: errors
                });
            }

            req[property] = value;
            next();
        };
    }

    /**
     * Validation de sécurité pour les uploads
     */
    static validateUploadSecurity(file, req) {
        const errors = [];

        // Vérifier les magic bytes (signatures de fichier)
        if (!this.validateMagicBytes(file.buffer, file.originalname)) {
            errors.push('Signature de fichier invalide');
        }

        // Vérifier la taille réelle vs déclarée
        if (file.buffer.length !== file.size) {
            errors.push('Taille de fichier incohérente');
        }

        // Vérifier les métadonnées suspectes
        if (this.containsSuspiciousContent(file.originalname)) {
            errors.push('Nom de fichier suspect');
        }

        // Rate limiting par IP
        const userAgent = req.get('User-Agent') || '';
        if (this.isSuspiciousUserAgent(userAgent)) {
            errors.push('User-Agent suspect');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Valider les magic bytes d'un fichier
     */
    static validateMagicBytes(buffer, filename) {
        if (!buffer || buffer.length < 4) return false;

        const magicBytes = {
            // Images
            'jpg': [0xFF, 0xD8, 0xFF],
            'png': [0x89, 0x50, 0x4E, 0x47],
            'webp': [0x52, 0x49, 0x46, 0x46], // + WEBP à l'offset 8
            'pdf': [0x25, 0x50, 0x44, 0x46],
            // Ajouter d'autres signatures selon les besoins
        };

        const ext = require('path').extname(filename).toLowerCase().substring(1);
        const expectedSignature = magicBytes[ext];

        if (!expectedSignature) {
            return true; // Pas de signature connue, on laisse passer
        }

        for (let i = 0; i < expectedSignature.length; i++) {
            if (buffer[i] !== expectedSignature[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * Détecter du contenu suspect dans un nom de fichier
     */
    static containsSuspiciousContent(filename) {
        const suspiciousPatterns = [
            /\.(exe|bat|cmd|scr|pif|com)$/i,
            /\.(php|asp|jsp|cgi)$/i,
            /<script/i,
            /javascript:/i,
            /\.\./,
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(filename));
    }

    /**
     * Détecter un User-Agent suspect
     */
    static isSuspiciousUserAgent(userAgent) {
        if (!userAgent || userAgent.length < 10) return true;
        
        const suspiciousPatterns = [
            /bot|crawler|spider|scraper/i,
            /^curl/i,
            /^wget/i,
            /python-requests/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(userAgent));
    }
}

/**
 * Middleware de validation rapide pour les routes Express
 */
const validateRequest = {
    upload: ValidationService.createValidationMiddleware(ValidationSchemas.uploadSchema),
    jobId: ValidationService.createValidationMiddleware(ValidationSchemas.jobIdSchema, 'params'),
    pagination: ValidationService.createValidationMiddleware(ValidationSchemas.paginationSchema, 'query'),
    jobFilters: ValidationService.createValidationMiddleware(ValidationSchemas.jobFiltersSchema, 'query'),
    healthCheck: ValidationService.createValidationMiddleware(ValidationSchemas.healthCheckSchema, 'query')
};

module.exports = {
    ValidationSchemas,
    ValidationService,
    validateRequest
};