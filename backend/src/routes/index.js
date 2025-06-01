// backend/src/routes/index.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

const uploadRoutes = require('./upload');
const statusRoutes = require('./status');
const downloadRoutes = require('./download');
const processRoutes = require('./process');
const healthRoutes = require('./health');

const logger = require('../utils/logger');

const router = express.Router();

/**
 * Configuration CORS
 */
const corsOptions = {
    origin: function (origin, callback) {
        // Permettre les requêtes sans origin (apps mobiles, Postman, etc.)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
        
        if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            logger.security('CORS origin bloqué', { origin, allowedOrigins });
            callback(new Error('Non autorisé par CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['X-Total-Count', 'X-Original-Size', 'X-Compressed-Size', 'X-Compression-Ratio']
};

/**
 * Rate limiting global
 */
const globalRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT) || 100, // 100 requêtes par 15min
    message: {
        success: false,
        error: 'Trop de requêtes, veuillez ralentir',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Utiliser l'IP comme clé
        return req.ip;
    },
    skip: (req) => {
        // Skip rate limiting pour les health checks
        if (req.path.startsWith('/api/health')) return true;
        
        // Skip en développement si configuré
        return process.env.NODE_ENV === 'development' && 
               process.env.SKIP_RATE_LIMIT === 'true';
    },
    onLimitReached: (req) => {
        logger.security('Rate limit global atteint', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            method: req.method
        });
    }
});

/**
 * Middleware de logging des requêtes
 */
const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    // Log de la requête entrante
    logger.http('Requête entrante', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length'),
        contentType: req.get('Content-Type')
    });

    // Override de res.end pour logger la réponse
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Date.now() - start;
        
        logger.http('Réponse envoyée', {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            contentLength: res.get('Content-Length'),
            ip: req.ip
        });

        // Métriques de performance
        if (duration > 5000) { // Plus de 5 secondes
            logger.performance('Requête lente détectée', duration, {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode
            });
        }

        originalEnd.apply(this, args);
    };

    next();
};

/**
 * Middleware de validation des headers
 */
const validateHeaders = (req, res, next) => {
    // Vérifier Content-Type pour les requêtes POST/PUT
    if (['POST', 'PUT'].includes(req.method)) {
        const contentType = req.get('Content-Type');
        
        if (req.path.includes('/upload')) {
            // Les uploads doivent être multipart/form-data
            if (!contentType || !contentType.includes('multipart/form-data')) {
                logger.security('Content-Type invalide pour upload', {
                    contentType,
                    path: req.path,
                    ip: req.ip
                });
                return res.status(400).json({
                    success: false,
                    error: 'Content-Type multipart/form-data requis pour les uploads'
                });
            }
        } else if (!req.path.includes('/upload')) {
            // Les autres requêtes doivent être JSON
            if (contentType && !contentType.includes('application/json')) {
                logger.security('Content-Type invalide', {
                    contentType,
                    path: req.path,
                    ip: req.ip
                });
                return res.status(400).json({
                    success: false,
                    error: 'Content-Type application/json requis'
                });
            }
        }
    }

    next();
};

/**
 * Middleware d'authentification (optionnel)
 */
const authenticate = (req, res, next) => {
    // Si l'authentification est désactivée, passer
    if (process.env.AUTH_ENABLED !== 'true') {
        return next();
    }

    const apiKey = req.get('Authorization') || req.query.api_key;
    const expectedKey = process.env.API_KEY;

    if (!expectedKey) {
        logger.error('API_KEY non configurée mais AUTH_ENABLED=true');
        return res.status(500).json({
            success: false,
            error: 'Configuration d\'authentification incorrecte'
        });
    }

    if (!apiKey || apiKey.replace('Bearer ', '') !== expectedKey) {
        logger.security('Tentative d\'accès non autorisé', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            providedKey: apiKey ? 'présente' : 'absente'
        });
        
        return res.status(401).json({
            success: false,
            error: 'Clé API invalide ou manquante'
        });
    }

    next();
};

/**
 * Middleware de gestion d'erreurs
 */
const errorHandler = (error, req, res, next) => {
    logger.error('Erreur non gérée dans les routes:', error, {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    // Erreurs spécifiques
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            error: 'Fichier trop volumineux'
        });
    }

    if (error.message === 'Non autorisé par CORS') {
        return res.status(403).json({
            success: false,
            error: 'Origine non autorisée'
        });
    }

    // Erreur générique
    res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
};

/**
 * Configuration des middlewares globaux
 */
router.use(helmet({
    crossOriginEmbedderPolicy: false, // Nécessaire pour les uploads
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "ws:", "wss:"]
        }
    }
}));

router.use(cors(corsOptions));
router.use(globalRateLimit);
router.use(requestLogger);
router.use(validateHeaders);
router.use(authenticate);

/**
 * Routes principales
 */

// Health checks (sans authentification pour les load balancers)
router.use('/health', healthRoutes);

// API v1
router.use('/upload', uploadRoutes);
router.use('/status', statusRoutes);
router.use('/download', downloadRoutes);
router.use('/process', processRoutes);

/**
 * Route d'information générale
 */
router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'API Optimiseur de Fichiers Multimédia',
        version: process.env.npm_package_version || '2.0.0',
        endpoints: {
            upload: '/api/upload',
            status: '/api/status',
            download: '/api/download',
            process: '/api/process',
            health: '/api/health'
        },
        documentation: 'https://github.com/your-username/file-optimizer/wiki/API',
        support: 'https://github.com/your-username/file-optimizer/issues',
        timestamp: new Date().toISOString()
    });
});

/**
 * Route 404 pour les endpoints non trouvés
 */
router.use('*', (req, res) => {
    logger.warn('Endpoint non trouvé', {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    res.status(404).json({
        success: false,
        error: 'Endpoint non trouvé',
        path: req.originalUrl,
        availableEndpoints: [
            '/api/upload',
            '/api/status',
            '/api/download',
            '/api/process',
            '/api/health'
        ]
    });
});

/**
 * Gestionnaire d'erreurs global
 */
router.use(errorHandler);

module.exports = router;