// backend/src/utils/logger.js
const winston = require('winston');
const path = require('path');

/**
 * Configuration du système de logging avec Winston
 */
class Logger {
    constructor() {
        this.logger = null;
        this.init();
    }

    /**
     * Initialiser le logger Winston
     */
    init() {
        // Configuration des niveaux de log
        const levels = {
            error: 0,
            warn: 1,
            info: 2,
            http: 3,
            debug: 4
        };

        const colors = {
            error: 'red',
            warn: 'yellow',
            info: 'green',
            http: 'magenta',
            debug: 'cyan'
        };

        winston.addColors(colors);

        // Format personnalisé pour les logs
        const format = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.colorize({ all: true }),
            winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                let log = `[${timestamp}] ${level}: ${message}`;
                
                // Ajouter la stack trace pour les erreurs
                if (stack) {
                    log += `\n${stack}`;
                }
                
                // Ajouter les métadonnées si présentes
                if (Object.keys(meta).length > 0) {
                    log += `\n${JSON.stringify(meta, null, 2)}`;
                }
                
                return log;
            })
        );

        // Configuration des transports
        const transports = [
            // Console pour le développement
            new winston.transports.Console({
                level: process.env.LOG_LEVEL || 'info',
                format
            })
        ];

        // Fichier de logs pour la production
        if (process.env.NODE_ENV === 'production') {
            const logDir = process.env.LOG_DIR || './logs';
            
            transports.push(
                // Logs généraux
                new winston.transports.File({
                    filename: path.join(logDir, 'app.log'),
                    level: 'info',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.errors({ stack: true }),
                        winston.format.json()
                    ),
                    maxsize: 50 * 1024 * 1024, // 50MB
                    maxFiles: 5,
                    tailable: true
                }),
                
                // Logs d'erreurs séparés
                new winston.transports.File({
                    filename: path.join(logDir, 'error.log'),
                    level: 'error',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.errors({ stack: true }),
                        winston.format.json()
                    ),
                    maxsize: 20 * 1024 * 1024, // 20MB
                    maxFiles: 5,
                    tailable: true
                })
            );
        }

        // Créer l'instance Winston
        this.logger = winston.createLogger({
            levels,
            level: process.env.LOG_LEVEL || 'info',
            transports,
            // Ne pas sortir sur les rejections non gérées
            exitOnError: false
        });

        // Gérer les exceptions non capturées
        this.logger.exceptions.handle(
            new winston.transports.Console({
                format
            })
        );

        // Gérer les rejections de promesses non gérées
        this.logger.rejections.handle(
            new winston.transports.Console({
                format
            })
        );
    }

    /**
     * Log de niveau info
     */
    info(message, meta = {}) {
        this.logger.info(message, meta);
    }

    /**
     * Log de niveau debug
     */
    debug(message, meta = {}) {
        this.logger.debug(message, meta);
    }

    /**
     * Log de niveau warn
     */
    warn(message, meta = {}) {
        this.logger.warn(message, meta);
    }

    /**
     * Log de niveau error
     */
    error(message, error = null, meta = {}) {
        if (error instanceof Error) {
            this.logger.error(message, { 
                error: error.message, 
                stack: error.stack,
                ...meta 
            });
        } else if (error) {
            this.logger.error(message, { error, ...meta });
        } else {
            this.logger.error(message, meta);
        }
    }

    /**
     * Log de niveau http pour les requêtes
     */
    http(message, meta = {}) {
        this.logger.http(message, meta);
    }

    /**
     * Logger spécialisé pour les jobs
     */
    job(jobId, message, meta = {}) {
        this.logger.info(`[JOB:${jobId}] ${message}`, meta);
    }

    /**
     * Logger spécialisé pour la queue
     */
    queue(message, meta = {}) {
        this.logger.info(`[QUEUE] ${message}`, meta);
    }

    /**
     * Logger spécialisé pour les fichiers
     */
    file(message, meta = {}) {
        this.logger.info(`[FILE] ${message}`, meta);
    }

    /**
     * Logger spécialisé pour le traitement
     */
    processing(message, meta = {}) {
        this.logger.info(`[PROCESSING] ${message}`, meta);
    }

    /**
     * Logger pour les performances
     */
    performance(operation, duration, meta = {}) {
        this.logger.info(`[PERF] ${operation} completed in ${duration}ms`, meta);
    }

    /**
     * Logger pour les métriques
     */
    metric(name, value, unit = '', meta = {}) {
        this.logger.info(`[METRIC] ${name}: ${value}${unit}`, meta);
    }

    /**
     * Logger pour la sécurité
     */
    security(message, meta = {}) {
        this.logger.warn(`[SECURITY] ${message}`, meta);
    }

    /**
     * Créer un timer pour mesurer les performances
     */
    timer(label) {
        const start = Date.now();
        return {
            end: (meta = {}) => {
                const duration = Date.now() - start;
                this.performance(label, duration, meta);
                return duration;
            }
        };
    }

    /**
     * Logger avec contexte (pour suivre une requête)
     */
    withContext(context) {
        return {
            info: (message, meta = {}) => this.info(message, { ...context, ...meta }),
            debug: (message, meta = {}) => this.debug(message, { ...context, ...meta }),
            warn: (message, meta = {}) => this.warn(message, { ...context, ...meta }),
            error: (message, error = null, meta = {}) => this.error(message, error, { ...context, ...meta }),
            http: (message, meta = {}) => this.http(message, { ...context, ...meta })
        };
    }

    /**
     * Obtenir l'instance Winston native si nécessaire
     */
    getInstance() {
        return this.logger;
    }

    /**
     * Créer un stream pour intégration avec Express Morgan
     */
    stream() {
        return {
            write: (message) => {
                this.http(message.trim());
            }
        };
    }

    /**
     * Changer le niveau de log à chaud
     */
    setLevel(level) {
        this.logger.level = level;
        this.logger.transports.forEach(transport => {
            if (transport.level !== 'error') { // Garder error.log sur error
                transport.level = level;
            }
        });
        this.info(`Log level changed to: ${level}`);
    }

    /**
     * Ajouter un transport personnalisé
     */
    addTransport(transport) {
        this.logger.add(transport);
    }

    /**
     * Supprimer un transport
     */
    removeTransport(transport) {
        this.logger.remove(transport);
    }

    /**
     * Vider les logs (pour les tests)
     */
    clear() {
        this.logger.clear();
    }

    /**
     * Fermer le logger proprement
     */
    close() {
        return new Promise((resolve) => {
            this.logger.on('finish', resolve);
            this.logger.end();
        });
    }
}

// Singleton
const logger = new Logger();

// Export des méthodes principales pour faciliter l'usage
module.exports = {
    info: logger.info.bind(logger),
    debug: logger.debug.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    http: logger.http.bind(logger),
    job: logger.job.bind(logger),
    queue: logger.queue.bind(logger),
    file: logger.file.bind(logger),
    processing: logger.processing.bind(logger),
    performance: logger.performance.bind(logger),
    metric: logger.metric.bind(logger),
    security: logger.security.bind(logger),
    timer: logger.timer.bind(logger),
    withContext: logger.withContext.bind(logger),
    stream: logger.stream.bind(logger),
    setLevel: logger.setLevel.bind(logger),
    getInstance: logger.getInstance.bind(logger),
    close: logger.close.bind(logger)
};