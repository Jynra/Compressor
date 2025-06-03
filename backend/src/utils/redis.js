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
        this.shutdownPromise = null;
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
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 30000); // 30s timeout

                const checkConnection = () => {
                    if (this.isConnected && this.client) {
                        clearTimeout(timeout);
                        resolve(this.client);
                    } else if (!this.isConnecting) {
                        clearTimeout(timeout);
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
                host: config.socket?.host || config.host || 'localhost',
                port: config.socket?.port || config.port || 6379,
                database: config.database || 0
            });

            this.client = createClient(config);

            // Gestionnaires d'événements
            this.setupEventHandlers();

            // Connexion avec timeout
            const connectPromise = this.client.connect();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Redis connection timeout')), 15000);
            });

            await Promise.race([connectPromise, timeoutPromise]);
            
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
            this.client = null;
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
                    connectTimeout: 10000,
                    lazyConnect: true,
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

        // Validation des variables d'environnement
        const port = parseInt(process.env.REDIS_PORT);
        const database = parseInt(process.env.REDIS_DATABASE);

        // Configuration par défaut
        return {
            socket: {
                host: process.env.REDIS_HOST || 'localhost',
                port: isNaN(port) ? 6379 : port,
                connectTimeout: 10000,
                lazyConnect: true,
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
            database: isNaN(database) ? 0 : database,
            retry_unfulfilled_commands: true,
            // Autres options utiles
            name: 'file-optimizer-redis',
            pingInterval: 30000,
            // Commandes à ne pas retry en cas d'erreur
            retryDelayOnFailover: 100,
            enableOfflineQueue: false
        };
    }

    /**
     * Configurer les gestionnaires d'événements Redis
     */
    setupEventHandlers() {
        if (!this.client) return;

        this.client.on('ready', () => {
            logger.info('Redis client ready');
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        this.client.on('connect', () => {
            logger.info('Redis client connected');
            this.isConnected = true;
        });

        this.client.on('reconnecting', () => {
            this.reconnectAttempts++;
            logger.warn(`Redis reconnecting (attempt ${this.reconnectAttempts})`);
            this.isConnected = false;
        });

        this.client.on('error', (error) => {
            logger.error('Redis client error:', {
                message: error.message,
                code: error.code,
                errno: error.errno,
                syscall: error.syscall
            });
            this.isConnected = false;
            
            // Si trop d'erreurs, réinitialiser le client
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.client = null;
            }
        });

        this.client.on('end', () => {
            logger.warn('Redis client disconnected');
            this.isConnected = false;
        });

        // Gestion gracieuse de l'arrêt (éviter les doublons)
        if (!this.shutdownHandlersRegistered) {
            process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
            process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
            process.on('uncaughtException', (error) => {
                logger.error('Uncaught exception, closing Redis:', error);
                this.gracefulShutdown('uncaughtException');
            });
            this.shutdownHandlersRegistered = true;
        }
    }

    /**
     * Arrêt gracieux de Redis
     */
    async gracefulShutdown(signal) {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }

        this.shutdownPromise = new Promise(async (resolve) => {
            logger.info(`Redis: Arrêt gracieux reçu (${signal})`);
            
            if (this.client && this.isConnected) {
                try {
                    // Timeout pour éviter d'attendre indéfiniment
                    const shutdownTimeout = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Shutdown timeout')), 5000);
                    });

                    await Promise.race([
                        this.client.quit(),
                        shutdownTimeout
                    ]);

                    logger.info('Redis: Connexion fermée proprement');
                } catch (error) {
                    logger.error('Redis: Erreur lors de la fermeture:', error);
                    // Force la fermeture
                    try {
                        await this.client.disconnect();
                    } catch (disconnectError) {
                        logger.error('Redis: Erreur disconnect:', disconnectError);
                    }
                }
            }

            this.isConnected = false;
            this.client = null;
            resolve();
        });

        return this.shutdownPromise;
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
        return this.isConnected && this.client && !this.client.isOpen === false;
    }

    /**
     * Test de santé Redis
     */
    async healthCheck() {
        try {
            if (!this.isConnected || !this.client) {
                return { 
                    status: 'error', 
                    message: 'Not connected',
                    connected: false,
                    reconnectAttempts: this.reconnectAttempts
                };
            }

            const start = Date.now();
            const pong = await this.client.ping();
            const latency = Date.now() - start;

            return {
                status: pong === 'PONG' ? 'ok' : 'error',
                latency: `${latency}ms`,
                connected: this.isConnected,
                reconnectAttempts: this.reconnectAttempts,
                clientReady: this.client.isReady
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                connected: false,
                reconnectAttempts: this.reconnectAttempts
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
        if (!infoString || typeof infoString !== 'string') {
            return {};
        }

        const info = {};
        const lines = infoString.split('\r\n');
        
        lines.forEach(line => {
            if (line.includes(':') && !line.startsWith('#')) {
                const [key, value] = line.split(':');
                if (key && value !== undefined) {
                    // Conversion intelligente des types
                    if (value === 'yes') info[key] = true;
                    else if (value === 'no') info[key] = false;
                    else if (!isNaN(value) && value !== '') info[key] = parseFloat(value);
                    else info[key] = value;
                }
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
                connected_clients: info.info?.connected_clients || 0,
                used_memory: info.memory?.used_memory || 0,
                used_memory_human: info.memory?.used_memory_human || '0B',
                total_commands_processed: info.info?.total_commands_processed || 0,
                keyspace_hits: info.info?.keyspace_hits || 0,
                keyspace_misses: info.info?.keyspace_misses || 0,
                hit_rate: info.info?.keyspace_hits && info.info?.keyspace_misses 
                    ? (info.info.keyspace_hits / (info.info.keyspace_hits + info.info.keyspace_misses) * 100).toFixed(2) + '%'
                    : '0%',
                db_size: dbSize,
                last_save_time: lastSave,
                uptime_in_seconds: info.info?.uptime_in_seconds || 0,
                redis_version: info.info?.redis_version || 'unknown'
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
                } else {
                    await this.client.disconnect();
                }
                this.isConnected = false;
                this.client = null;
                logger.info('Redis client closed');
            } catch (error) {
                logger.error('Erreur fermeture Redis:', error);
                // Force la fermeture
                this.client = null;
                this.isConnected = false;
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
                logger.warn(`Redis operation failed (attempt ${attempt}/${maxRetries}):`, {
                    message: error.message,
                    code: error.code
                });
                
                if (attempt < maxRetries) {
                    // Attendre avant de retry (backoff exponentiel)
                    const delay = Math.min(attempt * 1000, 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // Réinitialiser la connexion si nécessaire
                    if (!this.isConnected) {
                        this.client = null;
                    }
                }
            }
        }
        
        logger.error('Redis operation failed after all retries:', lastError);
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
        if (!key) throw new Error('Redis GET: key is required');
        return await redisClient.withRetry(async (client) => {
            return await client.get(key);
        });
    },

    // SET
    set: async (key, value, options = {}) => {
        if (!key) throw new Error('Redis SET: key is required');
        return await redisClient.withRetry(async (client) => {
            return await client.set(key, value, options);
        });
    },

    // HGET ALL
    hGetAll: async (key) => {
        if (!key) throw new Error('Redis HGETALL: key is required');
        return await redisClient.withRetry(async (client) => {
            return await client.hGetAll(key);
        });
    },

    // HSET
    hSet: async (key, field, value) => {
        if (!key || !field) throw new Error('Redis HSET: key and field are required');
        return await redisClient.withRetry(async (client) => {
            return await client.hSet(key, field, value);
        });
    },

    // HMSET (pour plusieurs champs)
    hMSet: async (key, hash) => {
        if (!key || !hash) throw new Error('Redis HMSET: key and hash are required');
        return await redisClient.withRetry(async (client) => {
            return await client.hSet(key, hash);
        });
    },

    // DEL
    del: async (key) => {
        if (!key) throw new Error('Redis DEL: key is required');
        return await redisClient.withRetry(async (client) => {
            return await client.del(key);
        });
    },

    // EXISTS
    exists: async (key) => {
        if (!key) throw new Error('Redis EXISTS: key is required');
        return await redisClient.withRetry(async (client) => {
            return await client.exists(key);
        });
    },

    // EXPIRE
    expire: async (key, seconds) => {
        if (!key || !seconds) throw new Error('Redis EXPIRE: key and seconds are required');
        return await redisClient.withRetry(async (client) => {
            return await client.expire(key, seconds);
        });
    },

    // INCR
    incr: async (key) => {
        if (!key) throw new Error('Redis INCR: key is required');
        return await redisClient.withRetry(async (client) => {
            return await client.incr(key);
        });
    },

    // SETEX (SET with expiration)
    setEx: async (key, seconds, value) => {
        if (!key || !seconds || value === undefined) {
            throw new Error('Redis SETEX: key, seconds and value are required');
        }
        return await redisClient.withRetry(async (client) => {
            return await client.setEx(key, seconds, value);
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
    flush: () => redisClient.flush(),
    isHealthy: () => redisClient.isHealthy()
};