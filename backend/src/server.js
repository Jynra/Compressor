// backend/src/server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const morgan = require('morgan');
const { Server } = require('socket.io');

// Services et utilitaires
const logger = require('./utils/logger');
const { getRedisClient } = require('./utils/redis');
const { cleanQueue } = require('./services/queueService');
const FileService = require('./services/fileService');

// Routes
const apiRoutes = require('./routes');

/**
 * Classe principale du serveur
 */
class FileOptimizerServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.io = null;
        this.redis = null;
        this.isShuttingDown = false;
        this.connections = new Set();
        this.startTime = Date.now();
    }

    /**
     * Initialiser le serveur
     */
    async init() {
        try {
            logger.info('🚀 Initialisation du serveur File Optimizer');

            // Vérifier les prérequis
            await this.checkPrerequisites();

            // Configuration de l'application Express
            await this.configureApp();

            // Configuration des routes
            this.configureRoutes();

            // Création du serveur HTTP/HTTPS
            await this.createServer();

            // Configuration WebSocket
            this.configureWebSocket();

            // Gestion gracieuse de l'arrêt
            this.setupGracefulShutdown();

            // Nettoyage périodique
            this.setupPeriodicCleanup();

            logger.info('✅ Serveur initialisé avec succès');
        } catch (error) {
            logger.error('❌ Erreur initialisation serveur:', error);
            throw error;
        }
    }

    /**
     * Vérifier les prérequis système
     */
    async checkPrerequisites() {
        logger.info('🔍 Vérification des prérequis...');

        try {
            // Vérifier Redis
            this.redis = await getRedisClient();
            await this.redis.ping();
            logger.info('✅ Redis connecté');

            // Vérifier les répertoires
            const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
            await FileService.ensureDirectoryExists(tempDir);
            await FileService.ensureDirectoryExists(path.join(tempDir, 'output'));
            logger.info('✅ Répertoires créés');

            // Vérifier Sharp
            const sharp = require('sharp');
            const sharpVersion = sharp.versions;
            logger.info(`✅ Sharp v${sharpVersion.sharp} disponible`);

            // Vérifier FFmpeg (optionnel)
            if (process.env.FFMPEG_PATH) {
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);
                
                try {
                    await execAsync(`${process.env.FFMPEG_PATH} -version`);
                    logger.info('✅ FFmpeg disponible');
                } catch (error) {
                    logger.warn('⚠️ FFmpeg non disponible (traitement vidéo/audio limité)');
                }
            }

        } catch (error) {
            logger.error('❌ Prérequis non satisfaits:', error);
            throw new Error(`Prérequis manquants: ${error.message}`);
        }
    }

    /**
     * Configuration de l'application Express
     */
    async configureApp() {
        logger.info('⚙️ Configuration Express...');

        // Middleware de base
        this.app.use(compression({
            threshold: 1024,
            level: 6,
            filter: (req, res) => {
                // Ne pas compresser les streams de fichiers
                if (req.path.includes('/download/')) return false;
                return compression.filter(req, res);
            }
        }));

        // Body parsing avec limites
        this.app.use(express.json({ 
            limit: process.env.BODY_LIMIT || '10mb',
            verify: (req, res, buf) => {
                // Vérification intégrité JSON
                req.rawBody = buf;
            }
        }));

        this.app.use(express.urlencoded({ 
            extended: true, 
            limit: process.env.BODY_LIMIT || '10mb' 
        }));

        // Trust proxy si nécessaire (pour rate limiting)
        if (process.env.TRUST_PROXY === 'true') {
            this.app.set('trust proxy', true);
        }

        // Logging HTTP avec Morgan
        const morganFormat = process.env.NODE_ENV === 'production' 
            ? 'combined' 
            : 'dev';
        
        this.app.use(morgan(morganFormat, { 
            stream: logger.stream(),
            skip: (req) => {
                // Skip health checks pour éviter spam
                return req.path.startsWith('/api/health');
            }
        }));

        // Middleware pour injecter Socket.IO dans les requêtes
        this.app.use((req, res, next) => {
            req.io = this.io;
            req.startTime = Date.now();
            next();
        });

        // Gestion des connexions pour graceful shutdown
        this.app.use((req, res, next) => {
            this.connections.add(res);
            res.on('close', () => this.connections.delete(res));
            next();
        });

        // Headers de sécurité supplémentaires
        this.app.use((req, res, next) => {
            res.setHeader('X-Powered-By', 'File Optimizer v2.0.0');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            
            if (process.env.HTTPS_ENABLED === 'true') {
                res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            }
            
            next();
        });

        logger.info('✅ Express configuré');
    }

    /**
     * Configuration des routes
     */
    configureRoutes() {
        logger.info('🛣️ Configuration des routes...');

        // Route racine avec informations serveur
        this.app.get('/', (req, res) => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);
            
            res.json({
                success: true,
                service: 'File Optimizer API',
                version: process.env.npm_package_version || '2.0.0',
                environment: process.env.NODE_ENV || 'development',
                uptime: uptime,
                uptimeFormatted: this.formatUptime(uptime),
                timestamp: new Date().toISOString(),
                endpoints: {
                    api: '/api',
                    health: '/api/health',
                    docs: '/docs',
                    metrics: '/api/health/metrics'
                },
                features: {
                    upload: true,
                    websockets: true,
                    compression: true,
                    monitoring: true,
                    authentication: process.env.AUTH_ENABLED === 'true'
                }
            });
        });

        // Routes API
        this.app.use('/api', apiRoutes);

        // Servir la documentation statique (si elle existe)
        const docsPath = path.join(__dirname, '../docs');
        if (fs.existsSync(docsPath)) {
            this.app.use('/docs', express.static(docsPath));
        }

        // Servir le frontend (si il existe)
        const frontendPath = path.join(__dirname, '../public');
        if (fs.existsSync(frontendPath)) {
            this.app.use('/app', express.static(frontendPath));
            
            // SPA fallback
            this.app.get('/app/*', (req, res) => {
                res.sendFile(path.join(frontendPath, 'index.html'));
            });
        }

        // Route pour les téléchargements directs (alias)
        this.app.get('/download/:jobId', (req, res) => {
            res.redirect(307, `/api/download/${req.params.jobId}`);
        });

        // Middleware 404 pour toutes les routes non trouvées
        this.app.use('*', (req, res) => {
            logger.warn('Route non trouvée', {
                method: req.method,
                path: req.originalUrl,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            res.status(404).json({
                success: false,
                error: 'Route non trouvée',
                path: req.originalUrl,
                suggestion: 'Consultez /api pour les endpoints disponibles'
            });
        });

        // Gestionnaire d'erreurs global
        this.app.use((error, req, res, next) => {
            const duration = Date.now() - req.startTime;
            
            logger.error('Erreur non gérée:', error, {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                duration: `${duration}ms`
            });

            // Ne pas exposer les détails d'erreur en production
            const isDev = process.env.NODE_ENV === 'development';
            
            res.status(error.status || 500).json({
                success: false,
                error: 'Erreur interne du serveur',
                message: isDev ? error.message : undefined,
                stack: isDev ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });
        });

        logger.info('✅ Routes configurées');
    }

    /**
     * Créer le serveur HTTP ou HTTPS
     */
    async createServer() {
        logger.info('🌐 Création du serveur...');

        const port = parseInt(process.env.PORT) || 8000;
        const host = process.env.HOST || '0.0.0.0';

        if (process.env.HTTPS_ENABLED === 'true') {
            // Serveur HTTPS
            const sslOptions = {
                key: fs.readFileSync(process.env.SSL_KEY_PATH),
                cert: fs.readFileSync(process.env.SSL_CERT_PATH)
            };
            
            this.server = https.createServer(sslOptions, this.app);
            logger.info(`🔒 Serveur HTTPS configuré`);
        } else {
            // Serveur HTTP
            this.server = http.createServer(this.app);
        }

        // Gestion des connexions pour graceful shutdown
        this.server.on('connection', (connection) => {
            this.connections.add(connection);
            connection.on('close', () => this.connections.delete(connection));
        });

        // Démarrer l'écoute
        await new Promise((resolve, reject) => {
            this.server.listen(port, host, (error) => {
                if (error) {
                    reject(error);
                } else {
                    const protocol = process.env.HTTPS_ENABLED === 'true' ? 'https' : 'http';
                    logger.info(`🚀 Serveur démarré sur ${protocol}://${host}:${port}`);
                    resolve();
                }
            });
        });
    }

    /**
     * Configuration WebSocket avec Socket.IO
     */
    configureWebSocket() {
        logger.info('🔌 Configuration WebSocket...');

        this.io = new Server(this.server, {
            cors: {
                origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
                methods: ['GET', 'POST'],
                credentials: true
            },
            transports: ['websocket', 'polling'],
            pingTimeout: 60000,
            pingInterval: 25000
        });

        // Middleware d'authentification WebSocket (optionnel)
        if (process.env.AUTH_ENABLED === 'true') {
            this.io.use((socket, next) => {
                const token = socket.handshake.auth.token || socket.handshake.query.token;
                
                if (!token || token !== process.env.API_KEY) {
                    logger.security('WebSocket connexion non autorisée', {
                        socketId: socket.id,
                        ip: socket.handshake.address
                    });
                    return next(new Error('Authentication failed'));
                }
                
                next();
            });
        }

        // Gestion des connexions WebSocket
        this.io.on('connection', (socket) => {
            logger.info('WebSocket connecté', {
                socketId: socket.id,
                ip: socket.handshake.address,
                userAgent: socket.handshake.headers['user-agent']
            });

            // Rejoindre une room pour un job spécifique
            socket.on('join-job', (jobId) => {
                if (this.isValidJobId(jobId)) {
                    socket.join(`job-${jobId}`);
                    socket.emit('joined-job', { jobId });
                    logger.debug(`Socket ${socket.id} rejoint job ${jobId}`);
                } else {
                    socket.emit('error', { message: 'Job ID invalide' });
                }
            });

            // Quitter une room de job
            socket.on('leave-job', (jobId) => {
                socket.leave(`job-${jobId}`);
                socket.emit('left-job', { jobId });
                logger.debug(`Socket ${socket.id} quitte job ${jobId}`);
            });

            // Demander le statut d'un job
            socket.on('get-status', async (jobId) => {
                try {
                    const JobService = require('./services/jobService');
                    const job = await JobService.getJob(jobId);
                    
                    if (job) {
                        socket.emit('job-status', {
                            jobId,
                            status: job.status,
                            progress: job.progress || 0,
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        socket.emit('error', { 
                            message: 'Job non trouvé',
                            jobId 
                        });
                    }
                } catch (error) {
                    logger.error('Erreur get-status WebSocket:', error);
                    socket.emit('error', { 
                        message: 'Erreur récupération statut' 
                    });
                }
            });

            // Gestion déconnexion
            socket.on('disconnect', (reason) => {
                logger.info('WebSocket déconnecté', {
                    socketId: socket.id,
                    reason,
                    ip: socket.handshake.address
                });
            });

            // Gestion des erreurs
            socket.on('error', (error) => {
                logger.error('Erreur WebSocket:', error, {
                    socketId: socket.id,
                    ip: socket.handshake.address
                });
            });
        });

        // Méthodes utilitaires pour émettre des événements
        this.io.emitJobUpdate = (jobId, data) => {
            this.io.to(`job-${jobId}`).emit('job-update', {
                jobId,
                ...data,
                timestamp: new Date().toISOString()
            });
        };

        this.io.emitJobProgress = (jobId, progress) => {
            this.io.to(`job-${jobId}`).emit('job-progress', {
                jobId,
                progress,
                timestamp: new Date().toISOString()
            });
        };

        this.io.emitJobCompleted = (jobId, result) => {
            this.io.to(`job-${jobId}`).emit('job-completed', {
                jobId,
                ...result,
                timestamp: new Date().toISOString()
            });
        };

        this.io.emitJobError = (jobId, error) => {
            this.io.to(`job-${jobId}`).emit('job-error', {
                jobId,
                error: error.message || error,
                timestamp: new Date().toISOString()
            });
        };

        logger.info('✅ WebSocket configuré');
    }

    /**
     * Configuration de l'arrêt gracieux
     */
    setupGracefulShutdown() {
        logger.info('🛡️ Configuration arrêt gracieux...');

        const shutdown = async (signal) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            logger.info(`🛑 Arrêt gracieux démarré (${signal})`);

            try {
                // 1. Arrêter d'accepter de nouvelles connexions
                this.server.close();

                // 2. Notifier les clients WebSocket
                if (this.io) {
                    this.io.emit('server-shutdown', {
                        message: 'Serveur en cours d\'arrêt',
                        timestamp: new Date().toISOString()
                    });

                    // Fermer les connexions WebSocket
                    setTimeout(() => {
                        this.io.close();
                    }, 1000);
                }

                // 3. Attendre la fin des requêtes en cours (max 30s)
                await this.waitForConnectionsToClose(30000);

                // 4. Nettoyer la queue
                await cleanQueue();

                // 5. Fermer Redis
                if (this.redis) {
                    await this.redis.quit();
                }

                logger.info('✅ Arrêt gracieux terminé');
                process.exit(0);

            } catch (error) {
                logger.error('❌ Erreur arrêt gracieux:', error);
                process.exit(1);
            }
        };

        // Signaux d'arrêt
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Nodemon

        // Erreurs non gérées
        process.on('uncaughtException', (error) => {
            logger.error('Exception non gérée:', error);
            shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Rejection non gérée:', reason, { promise });
            shutdown('unhandledRejection');
        });

        logger.info('✅ Arrêt gracieux configuré');
    }

    /**
     * Configuration du nettoyage périodique
     */
    setupPeriodicCleanup() {
        logger.info('🧹 Configuration nettoyage périodique...');

        const cleanupInterval = parseInt(process.env.CLEANUP_INTERVAL) || 3600; // 1h par défaut

        setInterval(async () => {
            try {
                logger.info('🧹 Nettoyage périodique démarré');

                // Nettoyer les fichiers temporaires
                const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
                const maxAge = parseInt(process.env.FILE_RETENTION) || 86400; // 24h par défaut
                
                const cleaned = await FileService.cleanupTempFiles(tempDir, maxAge * 1000);
                if (cleaned.count > 0) {
                    logger.info(`🧹 ${cleaned.count} fichiers nettoyés (${FileService.formatFileSize(cleaned.size)} libérés)`);
                }

                // Nettoyer les jobs expirés
                const JobService = require('./services/jobService');
                const jobsCleaned = await JobService.cleanupExpiredJobs();
                if (jobsCleaned > 0) {
                    logger.info(`🧹 ${jobsCleaned} jobs expirés supprimés`);
                }

                // Nettoyer la queue
                await cleanQueue();

                logger.info('✅ Nettoyage périodique terminé');

            } catch (error) {
                logger.error('❌ Erreur nettoyage périodique:', error);
            }
        }, cleanupInterval * 1000);

        logger.info(`✅ Nettoyage configuré (intervalle: ${cleanupInterval}s)`);
    }

    /**
     * Attendre la fermeture des connexions
     */
    async waitForConnectionsToClose(timeout = 30000) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const checkConnections = () => {
                if (this.connections.size === 0) {
                    logger.info('✅ Toutes les connexions fermées');
                    resolve();
                } else if (Date.now() - startTime >= timeout) {
                    logger.warn(`⚠️ Timeout atteint, fermeture forcée (${this.connections.size} connexions restantes)`);
                    // Fermer les connexions restantes
                    for (const connection of this.connections) {
                        connection.destroy();
                    }
                    resolve();
                } else {
                    setTimeout(checkConnections, 100);
                }
            };

            checkConnections();
        });
    }

    /**
     * Valider un ID de job
     */
    isValidJobId(jobId) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(jobId);
    }

    /**
     * Formater la durée d'uptime
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (days > 0) {
            return `${days}j ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Obtenir les statistiques du serveur
     */
    getServerStats() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const memUsage = process.memoryUsage();

        return {
            uptime,
            uptimeFormatted: this.formatUptime(uptime),
            connections: this.connections.size,
            memory: {
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                external: memUsage.external
            },
            websocket: {
                connected: this.io ? this.io.engine.clientsCount : 0
            },
            process: {
                pid: process.pid,
                platform: process.platform,
                nodeVersion: process.version
            }
        };
    }
}

/**
 * Fonction principale de démarrage
 */
async function main() {
    try {
        logger.info('🎯 File Optimizer Server v2.0.0');
        logger.info(`📍 Environnement: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🔧 Node.js: ${process.version}`);
        logger.info(`📂 Répertoire: ${process.cwd()}`);

        const server = new FileOptimizerServer();
        await server.init();

        // Exposer les stats serveur
        global.getServerStats = () => server.getServerStats();

        logger.info('🎉 File Optimizer Server démarré avec succès !');
        logger.info('📖 Documentation API: http://localhost:8000/docs');
        logger.info('🏥 Health check: http://localhost:8000/api/health');

    } catch (error) {
        logger.error('💥 Échec démarrage serveur:', error);
        process.exit(1);
    }
}

// Démarrer le serveur si ce fichier est exécuté directement
if (require.main === module) {
    main();
}

module.exports = { FileOptimizerServer, main };