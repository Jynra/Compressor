// backend/src/services/fileService.js - CORRIGÉ ET SÉCURISÉ
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Service de gestion des fichiers - SÉCURISÉ
 */
class FileService {
    /**
     * Formats supportés par type
     */
    static SUPPORTED_FORMATS = {
        images: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.tiff', '.bmp'],
        videos: ['.mp4', '.avi', '.mkv', '.webm', '.mov', '.flv', '.m4v'],
        audio: ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'],
        documents: ['.pdf']
    };

    /**
     * ✅ FIX: Validation sécurisée des chemins de fichier
     */
    static validateSecurePath(requestedPath, allowedBaseDir) {
        try {
            // Normaliser les chemins
            const normalizedRequested = path.normalize(requestedPath);
            const normalizedBase = path.normalize(allowedBaseDir);
            
            // Résoudre en chemin absolu
            const resolvedPath = path.resolve(normalizedRequested);
            const resolvedBase = path.resolve(normalizedBase);
            
            // Vérifier que le fichier reste dans le répertoire autorisé
            const isValid = resolvedPath.startsWith(resolvedBase + path.sep) || 
                           resolvedPath === resolvedBase;
            
            if (!isValid) {
                logger.security('Path traversal tenté', {
                    requestedPath,
                    allowedBaseDir,
                    resolvedPath,
                    resolvedBase
                });
            }
            
            return {
                isValid,
                resolvedPath: isValid ? resolvedPath : null,
                relativePath: isValid ? path.relative(resolvedBase, resolvedPath) : null
            };
        } catch (error) {
            logger.error('Erreur validation chemin:', error);
            return {
                isValid: false,
                resolvedPath: null,
                relativePath: null
            };
        }
    }

    /**
     * ✅ FIX: Suppression sécurisée de fichier
     */
    static async deleteSecureFile(filePath, allowedBaseDir = null) {
        try {
            // Validation du chemin si répertoire de base fourni
            if (allowedBaseDir) {
                const pathValidation = this.validateSecurePath(filePath, allowedBaseDir);
                if (!pathValidation.isValid) {
                    throw new Error('Chemin de fichier non autorisé');
                }
                filePath = pathValidation.resolvedPath;
            }
            
            // Vérifier que le fichier existe
            await fs.access(filePath);
            
            // Supprimer le fichier
            await fs.unlink(filePath);
            
            logger.file(`Fichier supprimé sécurisé: ${filePath}`);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug(`Fichier déjà supprimé: ${filePath}`);
                return true; // Considérer comme succès si déjà supprimé
            }
            
            logger.error(`Erreur suppression sécurisée ${filePath}:`, error);
            return false;
        }
    }

    /**
     * ✅ FIX: Génération de nom de fichier ultra-sécurisée
     */
    static generateSecureFilename(originalName) {
        try {
            const ext = path.extname(originalName);
            const timestamp = Date.now();
            const randomBytes = crypto.randomBytes(8).toString('hex');
            const uuid = crypto.randomUUID();
            
            // Nettoyer l'extension
            const cleanExt = ext.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
            
            // Générer nom ultra-sécurisé : UUID + timestamp + random + ext
            return `${uuid}-${timestamp}-${randomBytes}${cleanExt}`;
        } catch (error) {
            logger.error('Erreur génération nom sécurisé:', error);
            // Fallback ultra-sécurisé
            return `secure-${Date.now()}-${Math.random().toString(36)}.bin`;
        }
    }

    /**
     * ✅ FIX: Lecture sécurisée des métadonnées de fichier
     */
    static async getFileStatsSecure(filePath, allowedBaseDir = null) {
        try {
            // Validation du chemin si répertoire de base fourni
            if (allowedBaseDir) {
                const pathValidation = this.validateSecurePath(filePath, allowedBaseDir);
                if (!pathValidation.isValid) {
                    logger.security('Tentative lecture fichier non autorisée', {
                        filePath,
                        allowedBaseDir
                    });
                    return null;
                }
                filePath = pathValidation.resolvedPath;
            }
            
            const stats = await fs.stat(filePath);
            return {
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                permissions: stats.mode,
                secureRead: true
            };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Erreur lecture stats sécurisée ${filePath}:`, error);
            }
            return null;
        }
    }

    /**
     * ✅ FIX: Création de répertoire sécurisée
     */
    static async ensureDirectoryExistsSecure(dirPath, allowedBaseDir = null) {
        try {
            // Validation du chemin si répertoire de base fourni
            if (allowedBaseDir) {
                const pathValidation = this.validateSecurePath(dirPath, allowedBaseDir);
                if (!pathValidation.isValid) {
                    throw new Error('Répertoire non autorisé');
                }
                dirPath = pathValidation.resolvedPath;
            }
            
            await fs.access(dirPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(dirPath, { 
                    recursive: true,
                    mode: 0o755 // Permissions sécurisées
                });
                logger.info(`Répertoire créé sécurisé: ${dirPath}`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Obtenir tous les formats supportés
     */
    static getSupportedFormats() {
        return this.SUPPORTED_FORMATS;
    }

    /**
     * Déterminer le type d'un fichier basé sur son extension
     */
    static getFileType(filename) {
        const ext = path.extname(filename).toLowerCase();
        
        for (const [type, extensions] of Object.entries(this.SUPPORTED_FORMATS)) {
            if (extensions.includes(ext)) {
                return type.slice(0, -1); // Retire le 's' final (images -> image)
            }
        }
        
        return 'unknown';
    }

    /**
     * Vérifier si un fichier est supporté
     */
    static isValidFileType(filename) {
        const ext = path.extname(filename).toLowerCase();
        return Object.values(this.SUPPORTED_FORMATS).flat().includes(ext);
    }

    /**
     * Générer un nom de fichier unique (legacy - utiliser generateSecureFilename)
     */
    static generateUniqueFilename(originalName) {
        const ext = path.extname(originalName);
        const name = path.basename(originalName, ext);
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        
        // Nettoyer le nom original (caractères spéciaux)
        const cleanName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
        
        return `${cleanName}_${timestamp}_${random}${ext}`;
    }

    /**
     * Créer un répertoire s'il n'existe pas (legacy - utiliser ensureDirectoryExistsSecure)
     */
    static async ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch (error) {
            await fs.mkdir(dirPath, { recursive: true });
            logger.info(`Dossier créé: ${dirPath}`);
        }
    }

    /**
     * Obtenir les statistiques d'un fichier (legacy - utiliser getFileStatsSecure)
     */
    static async getFileStats(filePath) {
        return await this.getFileStatsSecure(filePath);
    }

    /**
     * Supprimer un fichier (legacy - utiliser deleteSecureFile)
     */
    static async deleteFile(filePath) {
        return await this.deleteSecureFile(filePath);
    }

    /**
     * Copier un fichier
     */
    static async copyFile(sourcePath, destPath) {
        try {
            await fs.copyFile(sourcePath, destPath);
            logger.info(`Fichier copié: ${sourcePath} -> ${destPath}`);
            return true;
        } catch (error) {
            logger.error(`Erreur copie ${sourcePath} -> ${destPath}:`, error);
            return false;
        }
    }

    /**
     * Déplacer un fichier
     */
    static async moveFile(sourcePath, destPath) {
        try {
            await fs.rename(sourcePath, destPath);
            logger.info(`Fichier déplacé: ${sourcePath} -> ${destPath}`);
            return true;
        } catch (error) {
            logger.error(`Erreur déplacement ${sourcePath} -> ${destPath}:`, error);
            return false;
        }
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
     * Calculer le ratio de compression
     */
    static calculateCompressionRatio(originalSize, compressedSize) {
        if (originalSize === 0) return 0;
        return Math.round(((originalSize - compressedSize) / originalSize) * 100);
    }

    /**
     * Vérifier l'intégrité d'un fichier via checksum
     */
    static async calculateChecksum(filePath, algorithm = 'md5') {
        try {
            const fileBuffer = await fs.readFile(filePath);
            const hashSum = crypto.createHash(algorithm);
            hashSum.update(fileBuffer);
            
            return hashSum.digest('hex');
        } catch (error) {
            logger.error(`Erreur calcul checksum ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Obtenir les informations détaillées d'un fichier
     */
    static async getFileInfo(filePath) {
        try {
            const stats = await this.getFileStats(filePath);
            if (!stats) return null;

            const filename = path.basename(filePath);
            const ext = path.extname(filename).toLowerCase();
            const type = this.getFileType(filename);
            const checksum = await this.calculateChecksum(filePath);

            return {
                path: filePath,
                filename,
                extension: ext,
                type,
                size: stats.size,
                sizeFormatted: this.formatFileSize(stats.size),
                created: stats.created,
                modified: stats.modified,
                checksum,
                isValid: this.isValidFileType(filename)
            };
        } catch (error) {
            logger.error(`Erreur info fichier ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Nettoyer les fichiers temporaires
     */
    static async cleanupTempFiles(tempDir, maxAge = 24 * 60 * 60 * 1000) { // 24h par défaut
        try {
            const files = await fs.readdir(tempDir);
            const now = Date.now();
            let cleanedCount = 0;
            let totalSize = 0;
            
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = await this.getFileStats(filePath);
                
                if (stats && stats.isFile) {
                    const age = now - stats.created.getTime();
                    
                    if (age > maxAge) {
                        totalSize += stats.size;
                        if (await this.deleteSecureFile(filePath, tempDir)) {
                            cleanedCount++;
                        }
                    }
                }
            }
            
            if (cleanedCount > 0) {
                logger.info(`Nettoyage: ${cleanedCount} fichiers supprimés (${this.formatFileSize(totalSize)} libérés)`);
            }
            
            return { count: cleanedCount, size: totalSize };
        } catch (error) {
            logger.error('Erreur nettoyage fichiers temporaires:', error);
            return { count: 0, size: 0 };
        }
    }

    /**
     * Lister les fichiers d'un répertoire avec filtres
     */
    static async listFiles(directory, options = {}) {
        try {
            const {
                extension = null,
                type = null,
                maxSize = null,
                minSize = null,
                recursive = false
            } = options;

            const files = [];
            const entries = await fs.readdir(directory, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);

                if (entry.isFile()) {
                    const fileInfo = await this.getFileInfo(fullPath);
                    if (!fileInfo) continue;

                    // Appliquer les filtres
                    if (extension && fileInfo.extension !== extension) continue;
                    if (type && fileInfo.type !== type) continue;
                    if (maxSize && fileInfo.size > maxSize) continue;
                    if (minSize && fileInfo.size < minSize) continue;

                    files.push(fileInfo);
                } else if (entry.isDirectory() && recursive) {
                    const subFiles = await this.listFiles(fullPath, options);
                    files.push(...subFiles);
                }
            }

            return files;
        } catch (error) {
            logger.error(`Erreur listage fichiers ${directory}:`, error);
            return [];
        }
    }

    /**
     * Obtenir l'usage disque d'un répertoire
     */
    static async getDirectorySize(directory) {
        try {
            let totalSize = 0;
            let fileCount = 0;

            const calculateSize = async (dir) => {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (entry.isFile()) {
                        const stats = await this.getFileStats(fullPath);
                        if (stats) {
                            totalSize += stats.size;
                            fileCount++;
                        }
                    } else if (entry.isDirectory()) {
                        await calculateSize(fullPath);
                    }
                }
            };

            await calculateSize(directory);

            return {
                size: totalSize,
                sizeFormatted: this.formatFileSize(totalSize),
                fileCount
            };
        } catch (error) {
            logger.error(`Erreur calcul taille répertoire ${directory}:`, error);
            return { size: 0, sizeFormatted: '0 B', fileCount: 0 };
        }
    }
}

module.exports = FileService;