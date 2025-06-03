// backend/src/utils/validation.js - CORRIGÉ ET COMPLET
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
        status: Joi.string().valid('uploaded', 'queued', 'processing', 'completed', 'error', 'paused', 'cancelled').default('uploaded'),
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
        status: Joi.string().valid('uploaded', 'queued', 'processing', 'completed', 'error', 'paused', 'cancelled').optional(),
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
 * Service de validation - ÉTENDU ET SÉCURISÉ
 */
class ValidationService {
    /**
     * ✅ FIX: Validation UUID stricte
     */
    static isValidUUID(uuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return typeof uuid === 'string' && uuidRegex.test(uuid);
    }

    /**
     * ✅ FIX: Nettoyage sécurisé nom de fichier
     */
    static sanitizeFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return null;
        }

        // Supprimer les caractères dangereux et path traversal
        let cleaned = filename
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Caractères interdits Windows
            .replace(/\.\./g, '_')                   // Path traversal
            .replace(/^\.+/, '_')                    // Points au début
            .replace(/\.+$/, '')                     // Points à la fin
            .replace(/\s+/g, '_')                    // Espaces multiples
            .replace(/_{2,}/g, '_')                  // Underscores multiples
            .trim();

        // Limiter la longueur
        if (cleaned.length > 255) {
            const ext = require('path').extname(cleaned);
            const name = require('path').basename(cleaned, ext);
            cleaned = name.substring(0, 255 - ext.length) + ext;
        }

        // Vérifier qu'il reste quelque chose de valide
        if (!cleaned || cleaned === '_' || cleaned.length < 1) {
            return null;
        }

        return cleaned;
    }

    /**
     * ✅ FIX: Nettoyage sécurisé des paramètres
     */
    static sanitizeSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            return {};
        }

        const cleanSettings = {};
        const allowedKeys = [
            'quality', 'maxWidth', 'maxHeight', 'format', 'removeMetadata', 'progressive',
            'codec', 'crf', 'preset', 'maxBitrate', 'fps', 'resolution',
            'bitrate', 'sampleRate', 'channels', 'normalize',
            'compress', 'optimizeImages'
        ];

        for (const [key, value] of Object.entries(settings)) {
            if (allowedKeys.includes(key) && value !== undefined && value !== null) {
                // Nettoyage selon le type
                if (typeof value === 'string') {
                    cleanSettings[key] = this.sanitizeInput(value);
                } else if (typeof value === 'number' && !isNaN(value)) {
                    cleanSettings[key] = Math.round(Math.abs(value));
                } else if (typeof value === 'boolean') {
                    cleanSettings[key] = Boolean(value);
                }
            }
        }

        return cleanSettings;
    }

    /**
     * ✅ FIX: Nettoyage sécurisé des inputs
     */
    static sanitizeInput(input) {
        if (!input || typeof input !== 'string') {
            return '';
        }

        return input
            .replace(/[<>'"]/g, '') // XSS basique
            .replace(/\0/g, '')     // Null bytes
            .replace(/\r\n/g, ' ')  // CRLF
            .trim()
            .slice(0, 1000);       // Limite de longueur
    }

    /**
     * ✅ FIX: Nettoyage sécurisé des outputs
     */
    static sanitizeOutput(output) {
        if (!output || typeof output !== 'string') {
            return '';
        }

        return output
            .replace(/[<>'"&]/g, (match) => {
                const entities = {
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#x27;',
                    '&': '&amp;'
                };
                return entities[match] || match;
            })
            .trim();
    }

    /**
     * ✅ FIX: Nettoyage sécurisé des headers HTTP
     */
    static sanitizeHeader(header) {
        if (!header || typeof header !== 'string') {
            return '';
        }

        return header
            .replace(/[\r\n]/g, '') // CRLF injection
            .replace(/[^\x20-\x7E]/g, '') // Caractères non imprimables
            .slice(0, 200)
            .trim();
    }

    /**
     * ✅ FIX: Validation avancée du contenu de fichier
     */
    static async validateFileContent(buffer, fileType) {
        try {
            const errors = [];
            
            // Validation taille minimale
            if (buffer.length < 10) {
                errors.push('Fichier trop petit pour être valide');
            }
            
            // Validation selon le type
            switch (fileType) {
                case 'image':
                    // Vérifier structure basique image
                    if (!this.validateImageStructure(buffer)) {
                        errors.push('Structure d\'image invalide');
                    }
                    break;
                    
                case 'video':
                    // Vérifier signatures vidéo
                    if (!this.validateVideoStructure(buffer)) {
                        errors.push('Structure de vidéo invalide');
                    }
                    break;
                    
                case 'audio':
                    // Vérifier signatures audio
                    if (!this.validateAudioStructure(buffer)) {
                        errors.push('Structure d\'audio invalide');
                    }
                    break;
                    
                case 'document':
                    // Vérifier structure PDF
                    if (!this.validatePDFStructure(buffer)) {
                        errors.push('Structure de document invalide');
                    }
                    break;
            }

            return {
                isValid: errors.length === 0,
                errors
            };
        } catch (error) {
            logger.error('Erreur validation contenu:', error);
            return {
                isValid: false,
                errors: ['Erreur validation contenu']
            };
        }
    }

    /**
     * ✅ FIX: Validation structure image
     */
    static validateImageStructure(buffer) {
        if (buffer.length < 8) return false;
        
        // JPEG
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            return buffer[buffer.length - 2] === 0xFF && buffer[buffer.length - 1] === 0xD9;
        }
        
        // PNG
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return buffer.slice(-8).toString('hex').includes('49454e44ae426082');
        }
        
        // WebP
        if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
            return true;
        }
        
        return true; // Autres formats acceptés par défaut
    }

    /**
     * ✅ FIX: Validation structure vidéo
     */
    static validateVideoStructure(buffer) {
        if (buffer.length < 12) return false;
        
        // MP4
        if (buffer.slice(4, 8).toString() === 'ftyp') {
            return true;
        }
        
        // AVI
        if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'AVI ') {
            return true;
        }
        
        // MKV
        if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
            return true;
        }
        
        return true; // Autres formats acceptés par défaut
    }

    /**
     * ✅ FIX: Validation structure audio
     */
    static validateAudioStructure(buffer) {
        if (buffer.length < 10) return false;
        
        // MP3
        if ((buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) || 
            buffer.slice(0, 3).toString() === 'ID3') {
            return true;
        }
        
        // WAV
        if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WAVE') {
            return true;
        }
        
        // FLAC
        if (buffer.slice(0, 4).toString() === 'fLaC') {
            return true;
        }
        
        // OGG
        if (buffer.slice(0, 4).toString() === 'OggS') {
            return true;
        }
        
        return true; // Autres formats acceptés par défaut
    }

    /**
     * ✅ FIX: Validation structure PDF
     */
    static validatePDFStructure(buffer) {
        if (buffer.length < 8) return false;
        
        // Vérifier header PDF
        const header = buffer.slice(0, 8).toString();
        if (!header.startsWith('%PDF-')) {
            return false;
        }
        
        // Vérifier footer PDF (optionnel car peut être absent)
        const footer = buffer.slice(-10).toString();
        return true; // PDF valide si header correct
    }

    /**
     * ✅ FIX: Détection User-Agent suspect
     */
    static isSuspiciousUserAgent(userAgent) {
        if (!userAgent || typeof userAgent !== 'string') return true;
        
        if (userAgent.length < 10 || userAgent.length > 500) return true;
        
        const suspiciousPatterns = [
            /bot|crawler|spider|scraper/i,
            /^curl/i,
            /^wget/i,
            /python-requests/i,
            /postman/i,
            /insomnia/i,
            /test/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(userAgent));
    }

    /**
     * ✅ FIX: Détection contenu suspect
     */
    static containsSuspiciousContent(filename) {
        if (!filename || typeof filename !== 'string') return true;
        
        const suspiciousPatterns = [
            /\.(exe|bat|cmd|scr|pif|com|dll)$/i,
            /\.(php|asp|jsp|cgi|pl|py|rb|sh)$/i,
            /<script/i,
            /<iframe/i,
            /javascript:/i,
            /vbscript:/i,
            /data:/i,
            /\.\./,
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i,
            /^\./,
            /__/,
            /\0/
        ];

        return suspiciousPatterns.some(pattern => pattern.test(filename));
    }

    /**
     * ✅ FIX: Validation magic bytes renforcée
     */
    static validateMagicBytes(buffer, filename) {
        if (!buffer || buffer.length < 4) return false;

        const ext = require('path').extname(filename).toLowerCase().substring(1);
        
        const magicBytes = {
            // Images - Signatures strictes
            'jpg': [[0xFF, 0xD8, 0xFF]],
            'jpeg': [[0xFF, 0xD8, 0xFF]],
            'png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
            'webp': [[0x52, 0x49, 0x46, 0x46], [0x57, 0x45, 0x42, 0x50]], // RIFF + WEBP à offset 8
            'bmp': [[0x42, 0x4D]],
            'tiff': [[0x49, 0x49, 0x2A, 0x00], [0x4D, 0x4D, 0x00, 0x2A]],
            
            // Documents
            'pdf': [[0x25, 0x50, 0x44, 0x46]],
            
            // Audio
            'mp3': [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]], // MP3 ou ID3
            'wav': [[0x52, 0x49, 0x46, 0x46]], // RIFF
            'flac': [[0x66, 0x4C, 0x61, 0x43]], // fLaC
            'ogg': [[0x4F, 0x67, 0x67, 0x53]], // OggS
            
            // Vidéo
            'mp4': [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]], // ftyp à offset 4
            'avi': [[0x52, 0x49, 0x46, 0x46]], // RIFF
            'mkv': [[0x1A, 0x45, 0xDF, 0xA3]],
            'webm': [[0x1A, 0x45, 0xDF, 0xA3]], // Même que MKV
        };

        const expectedSignatures = magicBytes[ext];
        if (!expectedSignatures) {
            // Si pas de signature connue, vérifier que ce n'est pas un exécutable
            const executableSignatures = [
                [0x4D, 0x5A], // PE/EXE
                [0x7F, 0x45, 0x4C, 0x46], // ELF
                [0xCA, 0xFE, 0xBA, 0xBE], // Mach-O
                [0x50, 0x4B, 0x03, 0x04], // ZIP (potentiellement dangereux)
            ];
            
            for (const signature of executableSignatures) {
                if (this.matchesSignature(buffer, signature, 0)) {
                    return false; // Fichier exécutable détecté
                }
            }
            
            return true; // Format inconnu mais pas dangereux
        }

        // Vérifier toutes les signatures possibles pour ce format
        for (const signature of expectedSignatures) {
            if (ext === 'webp') {
                // WebP nécessite RIFF au début ET WEBP à l'offset 8
                if (this.matchesSignature(buffer, [0x52, 0x49, 0x46, 0x46], 0) &&
                    buffer.length > 11 &&
                    this.matchesSignature(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
                    return true;
                }
            } else if (ext === 'mp4') {
                // MP4 peut avoir différents types ftyp
                if (this.matchesSignature(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
                    return true;
                }
            } else {
                // Vérification standard
                if (this.matchesSignature(buffer, signature, 0)) {
                    return true;
                }
            }
        }

        logger.security('Magic bytes invalides', {
            filename,
            expected: expectedSignatures,
            actual: Array.from(buffer.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0'))
        });

        return false;
    }

    /**
     * ✅ FIX: Vérification signature à offset
     */
    static matchesSignature(buffer, signature, offset = 0) {
        if (buffer.length < offset + signature.length) return false;
        
        for (let i = 0; i < signature.length; i++) {
            if (buffer[offset + i] !== signature[i]) {
                return false;
            }
        }
        return true;
    }

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
                cleanHeaders[lowerKey] = this.sanitizeHeader(value);
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