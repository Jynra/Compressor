// backend/src/services/jobService.js
const { getRedisClient } = require('../utils/redis');
const logger = require('../utils/logger');

const JOB_PREFIX = 'job:';
const JOB_INDEX = 'jobs:index';

/**
 * Service de gestion des jobs de traitement de fichiers
 */
class JobService {
    /**
     * Créer un nouveau job
     */
    static async createJob(jobData) {
        try {
            const redis = getRedisClient();
            const jobKey = `${JOB_PREFIX}${jobData.id}`;
            
            // Sérialiser les données complexes
            const serializedData = {
                ...jobData,
                settings: JSON.stringify(jobData.settings),
                createdAt: jobData.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            // Stocker le job dans Redis
            await redis.hSet(jobKey, serializedData);
            
            // Ajouter à l'index des jobs
            await redis.sAdd(JOB_INDEX, jobData.id);
            
            // Expiration après 7 jours
            await redis.expire(jobKey, 7 * 24 * 60 * 60);
            
            logger.info(`Job créé: ${jobData.id}`);
            return jobData;
        } catch (error) {
            logger.error('Erreur création job:', error);
            throw error;
        }
    }

    /**
     * Récupérer un job par son ID
     */
    static async getJob(jobId) {
        try {
            const redis = getRedisClient();
            const jobKey = `${JOB_PREFIX}${jobId}`;
            const jobData = await redis.hGetAll(jobKey);
            
            if (!jobData || Object.keys(jobData).length === 0) {
                return null;
            }
            
            // Désérialiser les données JSON
            if (jobData.settings) {
                jobData.settings = JSON.parse(jobData.settings);
            }
            
            // Convertir les nombres
            if (jobData.size) jobData.size = parseInt(jobData.size);
            if (jobData.compressedSize) jobData.compressedSize = parseInt(jobData.compressedSize);
            if (jobData.progress) jobData.progress = parseInt(jobData.progress);
            if (jobData.compressionRatio) jobData.compressionRatio = parseInt(jobData.compressionRatio);
            
            return jobData;
        } catch (error) {
            logger.error(`Erreur récupération job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Mettre à jour un job
     */
    static async updateJob(jobId, updates) {
        try {
            const redis = getRedisClient();
            const jobKey = `${JOB_PREFIX}${jobId}`;
            
            // Sérialiser les objets complexes
            const serializedUpdates = {
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            // Sérialiser les objets si nécessaire
            for (const [key, value] of Object.entries(serializedUpdates)) {
                if (typeof value === 'object' && value !== null && key !== 'updatedAt') {
                    serializedUpdates[key] = JSON.stringify(value);
                }
            }
            
            await redis.hSet(jobKey, serializedUpdates);
            logger.debug(`Job mis à jour: ${jobId}`);
            
            return true;
        } catch (error) {
            logger.error(`Erreur mise à jour job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Supprimer un job
     */
    static async deleteJob(jobId) {
        try {
            const redis = getRedisClient();
            const jobKey = `${JOB_PREFIX}${jobId}`;
            
            await redis.del(jobKey);
            await redis.sRem(JOB_INDEX, jobId);
            
            logger.info(`Job supprimé: ${jobId}`);
            return true;
        } catch (error) {
            logger.error(`Erreur suppression job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Récupérer tous les jobs
     */
    static async getAllJobs(limit = 100) {
        try {
            const redis = getRedisClient();
            const jobIds = await redis.sMembers(JOB_INDEX);
            
            const jobs = [];
            for (const jobId of jobIds.slice(0, limit)) {
                const job = await this.getJob(jobId);
                if (job) {
                    jobs.push(job);
                }
            }
            
            // Trier par date de création (plus récent en premier)
            jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            return jobs;
        } catch (error) {
            logger.error('Erreur récupération jobs:', error);
            throw error;
        }
    }

    /**
     * Récupérer les statistiques des jobs
     */
    static async getJobStats() {
        try {
            const redis = getRedisClient();
            const jobIds = await redis.sMembers(JOB_INDEX);
            
            const stats = {
                total: jobIds.length,
                uploaded: 0,
                queued: 0,
                processing: 0,
                completed: 0,
                error: 0
            };
            
            for (const jobId of jobIds) {
                const job = await this.getJob(jobId);
                if (job && job.status) {
                    stats[job.status] = (stats[job.status] || 0) + 1;
                }
            }
            
            return stats;
        } catch (error) {
            logger.error('Erreur stats jobs:', error);
            throw error;
        }
    }

    /**
     * Nettoyer les jobs expirés
     */
    static async cleanupExpiredJobs(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 jours par défaut
        try {
            const redis = getRedisClient();
            const jobIds = await redis.sMembers(JOB_INDEX);
            const now = new Date();
            let cleanedCount = 0;
            
            for (const jobId of jobIds) {
                const job = await this.getJob(jobId);
                if (job) {
                    const createdAt = new Date(job.createdAt);
                    if (now - createdAt > maxAge) {
                        await this.deleteJob(jobId);
                        cleanedCount++;
                    }
                }
            }
            
            if (cleanedCount > 0) {
                logger.info(`Jobs nettoyés: ${cleanedCount}`);
            }
            
            return cleanedCount;
        } catch (error) {
            logger.error('Erreur nettoyage jobs:', error);
            throw error;
        }
    }
}

module.exports = JobService;