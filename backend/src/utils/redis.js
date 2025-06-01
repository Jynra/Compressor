// backend/src/utils/redis.js
const { createClient } = require('redis');
const logger = require('./logger');

/**
 * Client Redis singleton avec gestion de connexion robuste
 */
class RedisClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // 1 seconde
    }

    /**
     * Initialiser la connexion Redis
     */
    async init() {
        if (this.client && this.isConnected) {
            return this.client;
        }

        if (this.isConnecting) {
            // Attendre que la connexion en cours se termine
            return new Promise((resolve, reject) => {
                const checkConnection = () => {
                    if (this.isConnected && this.client) {
                        resolve(this.client);
                    } else if (!this.isConnecting) {
                        reject(new Error('Connection failed'));
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });
        }

        this.isConnecting = true;

        try {
            // Configuration de la connexion
            const config = this.getRedisConfig();
            
            logger.info('Initialisation de la connexion Redis', { 
                host: config.socket?.host || config.host,
                port: config.socket?.port || config.port,
                database: config.database
            });

            this.client = createClient(config);

            // Gestionnaires d'événements
            this.setupEventHandlers();

            // Connexion
            await this.client.connect();
            
            this.isConnected = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            
            logger.info('Redis connecté avec succès');
            
            // Test de la connexion
            await this.client.ping();
            
            return this.client;
        } catch (error) {
            this.isConnecting = false;
            this.isConnected = false;
            logger.error('Erreur connexion Redis:', error);
            throw error;
        }
    }

    /**
     * Obtenir la configuration Redis depuis les variables d'environnement
     */
    getRedisConfig() {
        const redisUrl = process.env.REDIS_URL;
        
        if (redisUrl) {
            // Parse de l'URL Redis
            return {
                url: redisUrl,
                retry_unfulfilled_commands: true,
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries >= this.maxReconnectAttempts) {
                            logger.error(`Redis: Trop de tentatives de reconnexion (${retries})`);
                            return false;
                        }
                        const delay = Math.min(retries * this.reconnectDelay, 30000);
                        logger.warn(`Redis: Tentative de reconnexion ${retries} dans ${delay}ms`);
                        return delay;
                    }
                }
            };
        }

        // Configuration par défaut
        return {
            socket: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                reconnectStrategy: (retries) => {
                    if (retries >= this.maxReconnectAttempts) {
                        logger.error(`Redis: Trop de tentatives de reconnexion (${retries})`);
                        return false;
                    }
                    const delay = Math.min(retries * this.reconnectDelay, 30000);
                    logger.warn(`Redis: Tentative de reconnexion ${retries} dans ${delay}ms`);
                    return delay;
                }
            },
            password: process.env.REDIS_PASSWORD || undefined,
            database: parseInt(process.env.REDIS_DATABASE) || 0,
            retry_unfulfilled_commands: true
        };
    }

    /**
     * Configurer les gestionnaires d'événements Redis
     */
    setupEventHandlers() {
        this.client.on('ready', () => {
            logger.info('Redis client ready');
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        this.client.on('connect', () => {
            logger.info('Redis client connected');
        });

        this.client.on('reconnecting', () => {
            this.reconnectAttempts++;
            logger.warn(`Redis reconnecting (attempt ${this.reconnectAttempts})`);
            this.isConnected = false;
        });

        this.client.on('error', (error) => {
            logger.error('Redis client error:', error);
            this.isConnected = false;
        });

        this.client.on('end', () => {
            logger.warn('Redis client disconnected');
            this.isConnected = false;
        });

        // Gestion gracieuse de l'arrêt
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    }

    /**
     * Arrêt gracieux de Redis
     */
    async gracefulShutdown(signal) {
        logger.info(`Redis: Arrêt gracieux reçu (${signal})`);
        if (this.client && this.isConnected) {
            try {
                await this.client.quit();
                logger.info('Redis: Connexion fermée proprement');
            } catch (error) {
                logger.error('Redis: Erreur lors de la fermeture:', error);
            }
        }
    }

    /**
     * Obtenir le client Redis (avec auto-connexion)
     */
    async getClient() {
        if (!this.client || !this.isConnected) {
            await this.init();
        }
        return this.client;
    }

    /**
     * Vérifier si Redis est connecté
     */
    isHealthy() {
        return this.isConnected && this.client;
    }

    /**
     * Test de santé Redis
     */
    async healthCheck() {
        try {
            if (!this.isConnected || !this.client) {
                return { status: 'error', message: 'Not connected' };
            }

            const start = Date.now();
            await this.client.ping();
            const latency = Date.now() - start;

            return {
                status: 'ok',
                latency: `${latency}ms`,
                connected: this.isConnected,
                reconnectAttempts: this.reconnectAttempts
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                connected: false
            };
        }
    }

    /**
     * Obtenir les informations de Redis
     */
    async getInfo() {
        try {
            const client = await this.getClient();
            const info = await client.info();
            const memory = await client.info('memory');
            
            return {
                info: this.parseRedisInfo(info),
                memory: this.parseRedisInfo(memory)
            };
        } catch (error) {
            logger.error('Erreur récupération info Redis:', error);
            return null;
        }
    }

    /**
     * Parser les informations Redis
     */
    parseRedisInfo(infoString) {
        const info = {};
        const lines = infoString.split('\r\n');
        
        lines.forEach(line => {
            if (line.includes(':') && !line.startsWith('#')) {
                const [key, value] = line.split(':');
                info[key] = isNaN(value) ? value : parseFloat(value);
            }
        });
        
        return info;
    }

    /**
     * Obtenir les métriques Redis
     */
    async getMetrics() {
        try {
            const client = await this.getClient();
            const info = await this.getInfo();
            
            if (!info) return null;

            const dbSize = await client.dbSize();
            const lastSave = await client.lastSave();
            
            return {
                connected_clients: info.info.connected_clients || 0,
                used_memory: info.memory.used_memory || 0,
                used_memory_human: info.memory.used_memory_human || '0B',
                total_commands_processed: info.info.total_commands_processed || 0,
                keyspace_hits: info.info.keyspace_hits || 0,
                keyspace_misses: info.info.keyspace_misses || 0,
                db_size: dbSize,
                last_save_time: lastSave,
                uptime_in_seconds: info.info.uptime_in_seconds || 0
            };
        } catch (error) {
            logger.error('Erreur récupération métriques Redis:', error);
            return null;
        }
    }

    /**
     * Nettoyer Redis (pour les tests)
     */
    async flush() {
        try {
            const client = await this.getClient();
            await client.flushDb();
            logger.info('Redis database flushed');
        } catch (error) {
            logger.error('Erreur flush Redis:', error);
            throw error;
        }
    }

    /**
     * Fermer la connexion Redis
     */
    async close() {
        if (this.client) {
            try {
                if (this.isConnected) {
                    await this.client.quit();
                }
                this.isConnected = false;
                this.client = null;
                logger.info('Redis client closed');
            } catch (error) {
                logger.error('Erreur fermeture Redis:', error);
            }
        }
    }

    /**
     * Wrapper pour les opérations Redis avec retry automatique
     */
    async withRetry(operation, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const client = await this.getClient();
                return await operation(client);
            } catch (error) {
                lastError = error;
                logger.warn(`Redis operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
                
                if (attempt < maxRetries) {
                    // Attendre avant de retry
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                    // Réinitialiser la connexion si nécessaire
                    if (!this.isConnected) {
                        this.client = null;
                    }
                }
            }
        }
        
        throw lastError;
    }
}

// Singleton
const redisClient = new RedisClient();

/**
 * Obtenir le client Redis (fonction principale)
 */
async function getRedisClient() {
    return await redisClient.getClient();
}

/**
 * Wrapper simplifié pour les opérations courantes
 */
const redisOperations = {
    // GET
    get: async (key) => {
        return await redisClient.withRetry(async (client) => {
            return await client.get(key);
        });
    },

    // SET
    set: async (key, value, options = {}) => {
        return await redisClient.withRetry(async (client) => {
            return await client.set(key, value, options);
        });
    },

    // HGET ALL
    hGetAll: async (key) => {
        return await redisClient.withRetry(async (client) => {
            return await client.hGetAll(key);
        });
    },

    // HSET
    hSet: async (key, field, value) => {
        return await redisClient.withRetry(async (client) => {
            return await client.hSet(key, field, value);
        });
    },

    // DEL
    del: async (key) => {
        return await redisClient.withRetry(async (client) => {
            return await client.del(key);
        });
    },

    // EXISTS
    exists: async (key) => {
        return await redisClient.withRetry(async (client) => {
            return await client.exists(key);
        });
    },

    // EXPIRE
    expire: async (key, seconds) => {
        return await redisClient.withRetry(async (client) => {
            return await client.expire(key, seconds);
        });
    }
};

module.exports = {
    getRedisClient,
    redisClient,
    redisOperations,
    healthCheck: () => redisClient.healthCheck(),
    getInfo: () => redisClient.getInfo(),
    getMetrics: () => redisClient.getMetrics(),
    close: () => redisClient.close(),
    flush: () => redisClient.flush()
};