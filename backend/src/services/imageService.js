// backend/src/services/imageService.js
const sharp = require('sharp');
const path = require('path');
const FileService = require('./fileService');
const logger = require('../utils/logger');

/**
 * Service de traitement d'images
 */
class ImageService {
    /**
     * Traiter une image selon les paramètres fournis
     */
    static async processImage(inputPath, outputPath, settings = {}) {
        try {
            logger.info(`Traitement image: ${path.basename(inputPath)}`);

            // Paramètres par défaut
            const config = {
                quality: settings.quality || 80,
                maxWidth: settings.maxWidth || 1920,
                maxHeight: settings.maxHeight || 1080,
                format: settings.format || 'auto',
                removeMetadata: settings.removeMetadata !== false,
                progressive: settings.progressive !== false,
                ...settings
            };

            // Créer le processeur Sharp
            let processor = sharp(inputPath);

            // Obtenir les métadonnées de l'image originale
            const metadata = await processor.metadata();
            logger.debug(`Image originale: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

            // Redimensionnement si nécessaire
            if (this.shouldResize(metadata, config)) {
                processor = processor.resize(config.maxWidth, config.maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                });
                logger.debug(`Redimensionnement: ${config.maxWidth}x${config.maxHeight}`);
            }

            // Suppression des métadonnées EXIF
            if (config.removeMetadata) {
                processor = processor.removeMetadata();
            }

            // Rotation automatique basée sur EXIF
            if (metadata.orientation) {
                processor = processor.rotate();
            }

            // Configuration du format de sortie
            processor = this.configureOutputFormat(processor, config, metadata);

            // Traitement et sauvegarde
            await processor.toFile(outputPath);

            // Calculer les statistiques
            const originalStats = await FileService.getFileStats(inputPath);
            const processedStats = await FileService.getFileStats(outputPath);
            
            const result = {
                success: true,
                originalSize: originalStats.size,
                processedSize: processedStats.size,
                compressionRatio: FileService.calculateCompressionRatio(originalStats.size, processedStats.size),
                originalDimensions: { width: metadata.width, height: metadata.height },
                processedDimensions: await this.getImageDimensions(outputPath),
                outputPath
            };

            logger.info(`Image traitée: ${FileService.formatFileSize(originalStats.size)} -> ${FileService.formatFileSize(processedStats.size)} (${result.compressionRatio}%)`);

            return result;
        } catch (error) {
            logger.error('Erreur traitement image:', error);
            throw new Error(`Erreur traitement image: ${error.message}`);
        }
    }

    /**
     * Déterminer si l'image doit être redimensionnée
     */
    static shouldResize(metadata, config) {
        if (!metadata.width || !metadata.height) return false;
        if (!config.maxWidth && !config.maxHeight) return false;

        return metadata.width > config.maxWidth || metadata.height > config.maxHeight;
    }

    /**
     * Configurer le format de sortie
     */
    static configureOutputFormat(processor, config, metadata) {
        const format = config.format === 'auto' ? metadata.format : config.format;

        switch (format?.toLowerCase()) {
            case 'jpeg':
            case 'jpg':
                return processor.jpeg({
                    quality: config.quality,
                    progressive: config.progressive,
                    mozjpeg: true // Utiliser mozjpeg pour une meilleure compression
                });

            case 'png':
                return processor.png({
                    quality: config.quality,
                    progressive: config.progressive,
                    compressionLevel: Math.round(9 - (config.quality / 100) * 9)
                });

            case 'webp':
                return processor.webp({
                    quality: config.quality,
                    effort: 6 // Niveau d'effort de compression (0-6)
                });

            case 'avif':
                return processor.avif({
                    quality: config.quality,
                    effort: 4 // Niveau d'effort de compression (0-9)
                });

            case 'tiff':
                return processor.tiff({
                    quality: config.quality,
                    compression: 'lzw'
                });

            default:
                // Format par défaut: JPEG
                return processor.jpeg({
                    quality: config.quality,
                    progressive: config.progressive,
                    mozjpeg: true
                });
        }
    }

    /**
     * Obtenir les dimensions d'une image
     */
    static async getImageDimensions(imagePath) {
        try {
            const metadata = await sharp(imagePath).metadata();
            return {
                width: metadata.width,
                height: metadata.height
            };
        } catch (error) {
            logger.error(`Erreur lecture dimensions ${imagePath}:`, error);
            return { width: 0, height: 0 };
        }
    }

    /**
     * Obtenir les métadonnées détaillées d'une image
     */
    static async getImageMetadata(imagePath) {
        try {
            const metadata = await sharp(imagePath).metadata();
            return {
                format: metadata.format,
                width: metadata.width,
                height: metadata.height,
                channels: metadata.channels,
                depth: metadata.depth,
                density: metadata.density,
                hasAlpha: metadata.hasAlpha,
                orientation: metadata.orientation,
                colorSpace: metadata.space,
                exif: metadata.exif ? this.parseExifData(metadata.exif) : null
            };
        } catch (error) {
            logger.error(`Erreur lecture métadonnées ${imagePath}:`, error);
            return null;
        }
    }

    /**
     * Parser les données EXIF (basique)
     */
    static parseExifData(exifBuffer) {
        try {
            // Ici on pourrait utiliser une lib comme exif-parser pour plus de détails
            return {
                hasExif: true,
                size: exifBuffer.length
            };
        } catch (error) {
            return { hasExif: false };
        }
    }

    /**
     * Créer une vignette
     */
    static async createThumbnail(inputPath, outputPath, size = 200) {
        try {
            await sharp(inputPath)
                .resize(size, size, {
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ quality: 80 })
                .toFile(outputPath);

            logger.debug(`Vignette créée: ${outputPath}`);
            return outputPath;
        } catch (error) {
            logger.error(`Erreur création vignette:`, error);
            throw error;
        }
    }

    /**
     * Optimiser une image pour le web
     */
    static async optimizeForWeb(inputPath, outputPath) {
        try {
            const metadata = await sharp(inputPath).metadata();
            
            // Paramètres optimisés pour le web
            const webSettings = {
                quality: 85,
                maxWidth: 1920,
                maxHeight: 1920,
                format: this.getBestWebFormat(metadata.format),
                progressive: true,
                removeMetadata: true
            };

            return await this.processImage(inputPath, outputPath, webSettings);
        } catch (error) {
            logger.error('Erreur optimisation web:', error);
            throw error;
        }
    }

    /**
     * Déterminer le meilleur format pour le web
     */
    static getBestWebFormat(originalFormat) {
        // Priorité: WebP > AVIF > JPEG > PNG
        const supportModern = true; // À adapter selon le support navigateur

        if (supportModern) {
            if (originalFormat === 'png') {
                return 'webp'; // Garde la transparence
            }
            return 'webp'; // Meilleure compression générale
        }

        // Fallback pour anciens navigateurs
        return originalFormat === 'png' ? 'png' : 'jpeg';
    }

    /**
     * Redimensionner par lot
     */
    static async batchResize(inputPaths, outputDir, settings = {}) {
        const results = [];
        
        for (const inputPath of inputPaths) {
            try {
                const filename = path.basename(inputPath);
                const outputPath = path.join(outputDir, filename);
                
                const result = await this.processImage(inputPath, outputPath, settings);
                results.push({ ...result, inputPath });
            } catch (error) {
                logger.error(`Erreur traitement ${inputPath}:`, error);
                results.push({
                    success: false,
                    inputPath,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Valider qu'un fichier est bien une image
     */
    static async validateImage(imagePath) {
        try {
            const metadata = await sharp(imagePath).metadata();
            return {
                isValid: true,
                format: metadata.format,
                width: metadata.width,
                height: metadata.height
            };
        } catch (error) {
            return {
                isValid: false,
                error: error.message
            };
        }
    }
}

module.exports = ImageService;