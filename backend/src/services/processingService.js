// backend/src/services/processingService.js
const path = require('path');
const JobService = require('./jobService');
const FileService = require('./fileService');
const ImageService = require('./imageService');
const logger = require('../utils/logger');

/**
 * Service principal de traitement des fichiers
 */
class ProcessingService {
    /**
     * Traiter un fichier selon son type
     */
    static async processFile(jobData, progressCallback) {
        const fileType = FileService.getFileType(jobData.originalName);
        
        try {
            // Mettre à jour le statut à "processing"
            await JobService.updateJob(jobData.id, { 
                status: 'processing',
                progress: 5
            });
            
            progressCallback(10);
            
            let result;
            switch (fileType) {
                case 'image':
                    result = await this.processImage(jobData, progressCallback);
                    break;
                case 'video':
                    result = await this.processVideo(jobData, progressCallback);
                    break;
                case 'audio':
                    result = await this.processAudio(jobData, progressCallback);
                    break;
                case 'document':
                    result = await this.processDocument(jobData, progressCallback);
                    break;
                default:
                    throw new Error(`Type de fichier non supporté: ${fileType}`);
            }
            
            progressCallback(100);
            
            // Mettre à jour le job avec les résultats
            await JobService.updateJob(jobData.id, {
                status: 'completed',
                outputPath: result.outputPath,
                compressedSize: result.compressedSize,
                compressionRatio: result.compressionRatio,
                progress: 100
            });
            
            logger.info(`Traitement terminé pour job ${jobData.id}`);
            return result;
            
        } catch (error) {
            logger.error(`Erreur traitement job ${jobData.id}:`, error);
            
            await JobService.updateJob(jobData.id, {
                status: 'error',
                error: error.message,
                progress: 0
            });
            
            throw error;
        }
    }

    /**
     * Traiter une image
     */
    static async processImage(jobData, progressCallback) {
        try {
            logger.info(`Traitement image: ${jobData.originalName}`);
            
            // Préparer les chemins
            const outputDir = path.join(process.env.TEMP_DIR || '/tmp/uploads', 'output');
            await FileService.ensureDirectoryExists(outputDir);
            
            // Déterminer l'extension de sortie
            const outputExt = jobData.settings.format === 'auto' 
                ? path.extname(jobData.filePath) 
                : `.${jobData.settings.format}`;
            
            const outputPath = path.join(outputDir, `${jobData.id}${outputExt}`);
            
            progressCallback(20);
            
            // Traiter l'image avec ImageService
            const result = await ImageService.processImage(
                jobData.filePath, 
                outputPath, 
                jobData.settings
            );
            
            progressCallback(80);
            
            // Vérifier que le fichier de sortie existe
            const outputStats = await FileService.getFileStats(outputPath);
            if (!outputStats) {
                throw new Error('Fichier de sortie non créé');
            }
            
            logger.info(`Image traitée: ${jobData.originalName} -> ${FileService.formatFileSize(outputStats.size)}`);
            
            return {
                outputPath,
                compressedSize: outputStats.size,
                compressionRatio: FileService.calculateCompressionRatio(jobData.size, outputStats.size)
            };
            
        } catch (error) {
            logger.error(`Erreur traitement image ${jobData.id}:`, error);
            throw error;
        }
    }

    /**
     * Traiter une vidéo (implémentation basique)
     */
    static async processVideo(jobData, progressCallback) {
        try {
            logger.info(`Traitement vidéo: ${jobData.originalName}`);
            
            // Pour le moment, copie simple du fichier
            // TODO: Implémenter FFmpeg pour compression vidéo
            const outputDir = path.join(process.env.TEMP_DIR || '/tmp/uploads', 'output');
            await FileService.ensureDirectoryExists(outputDir);
            
            const outputPath = path.join(outputDir, `${jobData.id}_processed${path.extname(jobData.filePath)}`);
            
            progressCallback(30);
            
            // Copie temporaire (à remplacer par traitement FFmpeg)
            await FileService.copyFile(jobData.filePath, outputPath);
            
            progressCallback(90);
            
            const outputStats = await FileService.getFileStats(outputPath);
            
            logger.info(`Vidéo "traitée": ${jobData.originalName}`);
            
            return {
                outputPath,
                compressedSize: outputStats.size,
                compressionRatio: 0 // Pas de compression pour le moment
            };
            
        } catch (error) {
            logger.error(`Erreur traitement vidéo ${jobData.id}:`, error);
            throw error;
        }
    }

    /**
     * Traiter un fichier audio (implémentation basique)
     */
    static async processAudio(jobData, progressCallback) {
        try {
            logger.info(`Traitement audio: ${jobData.originalName}`);
            
            // Pour le moment, copie simple du fichier
            // TODO: Implémenter FFmpeg pour compression audio
            const outputDir = path.join(process.env.TEMP_DIR || '/tmp/uploads', 'output');
            await FileService.ensureDirectoryExists(outputDir);
            
            const outputPath = path.join(outputDir, `${jobData.id}_processed${path.extname(jobData.filePath)}`);
            
            progressCallback(40);
            
            // Copie temporaire (à remplacer par traitement FFmpeg)
            await FileService.copyFile(jobData.filePath, outputPath);
            
            progressCallback(90);
            
            const outputStats = await FileService.getFileStats(outputPath);
            
            logger.info(`Audio "traité": ${jobData.originalName}`);
            
            return {
                outputPath,
                compressedSize: outputStats.size,
                compressionRatio: 0 // Pas de compression pour le moment
            };
            
        } catch (error) {
            logger.error(`Erreur traitement audio ${jobData.id}:`, error);
            throw error;
        }
    }

    /**
     * Traiter un document (implémentation basique)
     */
    static async processDocument(jobData, progressCallback) {
        try {
            logger.info(`Traitement document: ${jobData.originalName}`);
            
            // Pour le moment, copie simple du fichier
            // TODO: Implémenter compression PDF
            const outputDir = path.join(process.env.TEMP_DIR || '/tmp/uploads', 'output');
            await FileService.ensureDirectoryExists(outputDir);
            
            const outputPath = path.join(outputDir, `${jobData.id}_processed.pdf`);
            
            progressCallback(50);
            
            // Copie temporaire (à remplacer par traitement PDF)
            await FileService.copyFile(jobData.filePath, outputPath);
            
            progressCallback(90);
            
            const outputStats = await FileService.getFileStats(outputPath);
            
            logger.info(`Document "traité": ${jobData.originalName}`);
            
            return {
                outputPath,
                compressedSize: outputStats.size,
                compressionRatio: 0 // Pas de compression pour le moment
            };
            
        } catch (error) {
            logger.error(`Erreur traitement document ${jobData.id}:`, error);
            throw error;
        }
    }

    /**
     * Valider un job avant traitement
     */
    static async validateJob(jobData) {
        const errors = [];

        // Vérifier que le fichier existe
        const fileStats = await FileService.getFileStats(jobData.filePath);
        if (!fileStats) {
            errors.push('Fichier source introuvable');
        }

        // Vérifier le type de fichier
        if (!FileService.isValidFileType(jobData.originalName)) {
            errors.push('Type de fichier non supporté');
        }

        // Vérifier les paramètres selon le type
        const fileType = FileService.getFileType(jobData.originalName);
        const validationErrors = this.validateSettings(fileType, jobData.settings);
        errors.push(...validationErrors);

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Valider les paramètres selon le type de fichier
     */
    static validateSettings(fileType, settings) {
        const errors = [];

        switch (fileType) {
            case 'image':
                if (settings.quality && (settings.quality < 1 || settings.quality > 100)) {
                    errors.push('Qualité doit être entre 1 et 100');
                }
                if (settings.maxWidth && settings.maxWidth < 100) {
                    errors.push('Largeur minimum: 100px');
                }
                if (settings.maxHeight && settings.maxHeight < 100) {
                    errors.push('Hauteur minimum: 100px');
                }
                break;
            
            case 'video':
                if (settings.crf && (settings.crf < 18 || settings.crf > 51)) {
                    errors.push('CRF doit être entre 18 et 51');
                }
                break;
                
            case 'audio':
                if (settings.sampleRate && ![22050, 44100, 48000].includes(settings.sampleRate)) {
                    errors.push('Fréquence d\'échantillonnage non supportée');
                }
                break;
        }

        return errors;
    }

    /**
     * Obtenir les paramètres par défaut selon le type de fichier
     */
    static getDefaultSettings(fileType) {
        const defaults = {
            image: {
                quality: 80,
                maxWidth: 1920,
                maxHeight: 1080,
                format: 'auto',
                removeMetadata: true
            },
            video: {
                codec: 'h264',
                crf: 23,
                preset: 'medium',
                maxBitrate: '2M'
            },
            audio: {
                codec: 'aac',
                bitrate: '128k',
                sampleRate: 44100
            },
            document: {
                compress: true,
                removeMetadata: true
            }
        };

        return defaults[fileType] || {};
    }

    /**
     * Estimer la durée de traitement
     */
    static estimateProcessingTime(fileType, fileSize) {
        // Estimation basique en secondes
        const sizeInMB = fileSize / (1024 * 1024);
        
        const estimates = {
            image: Math.max(2, sizeInMB * 0.5),      // ~0.5s par MB
            video: Math.max(10, sizeInMB * 2),       // ~2s par MB
            audio: Math.max(5, sizeInMB * 1),        // ~1s par MB
            document: Math.max(3, sizeInMB * 0.8)    // ~0.8s par MB
        };

        return Math.round(estimates[fileType] || 10);
    }
}

module.exports = ProcessingService;