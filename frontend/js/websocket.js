// js/websocket.js
// Client WebSocket pour la communication temps réel

/**
 * Gestionnaire WebSocket pour les communications temps réel
 */
class WebSocketManager {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // 1 seconde
        this.isConnecting = false;
        this.isConnected = false;
        this.eventHandlers = new Map();
        this.joinedRooms = new Set();
        this.logger = Utils.createLogger('WebSocket');
        this.connectionAttempts = 0;
        this.lastConnectionTime = null;
        this.pingInterval = null;
        this.isDestroyed = false;
        
        this.connect();
    }

    /**
     * Établir la connexion WebSocket
     */
    connect() {
        if (this.isDestroyed) {
            this.logger.warn('WebSocketManager détruit, connexion annulée');
            return;
        }

        if (this.isConnecting || this.isConnected) {
            this.logger.debug('Connexion déjà en cours ou établie');
            return;
        }

        try {
            this.isConnecting = true;
            this.connectionAttempts++;
            this.logger.info(`Connexion WebSocket... (tentative ${this.connectionAttempts})`);

            // ✅ FIX: Vérifier si Socket.IO est disponible
            if (typeof io === 'undefined') {
                throw new Error('Socket.IO non disponible');
            }

            // Initialiser Socket.IO avec configuration robuste
            this.socket = io(this.baseUrl, {
                transports: ['websocket', 'polling'],
                timeout: 20000,
                reconnection: false, // Gestion manuelle
                forceNew: true,
                // ✅ FIX: Options supplémentaires pour la stabilité
                upgrade: true,
                rememberUpgrade: true,
                autoConnect: true,
                randomizationFactor: 0.5,
                // Éviter les fuites mémoire
                forceBase64: false
            });

            this.setupEventHandlers();

        } catch (error) {
            this.logger.error('Erreur création WebSocket:', error);
            this.isConnecting = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Configuration des gestionnaires d'événements Socket.IO
     */
    setupEventHandlers() {
        if (!this.socket) return;

        // ✅ FIX: Nettoyer les anciens listeners
        this.socket.removeAllListeners();

        // Connexion établie
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            this.lastConnectionTime = Date.now();
            
            this.logger.info('WebSocket connecté', { 
                id: this.socket.id,
                transport: this.socket.io.engine.transport.name 
            });
            
            this.emit('connect');

            // Rejoindre les rooms précédemment jointes
            this.rejoinRooms();

            // ✅ NOUVEAU: Démarrer le ping périodique
            this.startPingInterval();
        });

        // Déconnexion
        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            this.stopPingInterval();
            
            this.logger.warn('WebSocket déconnecté:', {
                reason,
                lastConnection: this.lastConnectionTime ? 
                    `${Math.round((Date.now() - this.lastConnectionTime) / 1000)}s` : 'jamais'
            });
            
            this.emit('disconnect', reason);

            // Reconnexion automatique sauf si déconnexion volontaire
            if (reason !== 'io client disconnect' && !this.isDestroyed) {
                this.scheduleReconnect();
            }
        });

        // Erreur de connexion
        this.socket.on('connect_error', (error) => {
            this.isConnecting = false;
            this.logger.error('Erreur connexion WebSocket:', {
                message: error.message,
                type: error.type,
                description: error.description
            });
            this.emit('error', error);
            
            if (!this.isDestroyed) {
                this.scheduleReconnect();
            }
        });

        // ✅ FIX: Gestion des erreurs génériques
        this.socket.on('error', (error) => {
            this.logger.error('Erreur WebSocket générique:', error);
            this.emit('websocket-error', error);
        });

        // Événements métier avec validation
        this.socket.on('job-progress', (data) => {
            if (this.validateJobData(data, ['jobId', 'progress'])) {
                this.logger.debug('Progression job:', data);
                this.emit('job-progress', data);
            }
        });

        this.socket.on('job-completed', (data) => {
            if (this.validateJobData(data, ['jobId'])) {
                this.logger.info('Job terminé:', data.jobId);
                this.emit('job-completed', data);
            }
        });

        this.socket.on('job-error', (data) => {
            if (this.validateJobData(data, ['jobId', 'error'])) {
                this.logger.error('Erreur job:', data);
                this.emit('job-error', data);
            }
        });

        this.socket.on('job-queued', (data) => {
            if (this.validateJobData(data, ['jobId'])) {
                this.logger.info('Job en queue:', data.jobId);
                this.emit('job-queued', data);
            }
        });

        this.socket.on('job-started', (data) => {
            if (this.validateJobData(data, ['jobId'])) {
                this.logger.info('Job démarré:', data.jobId);
                this.emit('job-started', data);
            }
        });

        // Événements système
        this.socket.on('server-shutdown', (data) => {
            this.logger.warn('Serveur en arrêt:', data);
            this.emit('server-shutdown', data);
        });

        this.socket.on('server-maintenance', (data) => {
            this.logger.info('Maintenance serveur:', data);
            this.emit('server-maintenance', data);
        });

        // Événements de notification
        this.socket.on('notification', (data) => {
            this.logger.info('Notification:', data);
            this.emit('notification', data);
        });

        // Réponses aux requêtes
        this.socket.on('joined-job', (data) => {
            if (data && data.jobId) {
                this.joinedRooms.add(`job-${data.jobId}`);
                this.logger.debug('Rejoint room job:', data.jobId);
            }
        });

        this.socket.on('left-job', (data) => {
            if (data && data.jobId) {
                this.joinedRooms.delete(`job-${data.jobId}`);
                this.logger.debug('Quitté room job:', data.jobId);
            }
        });

        this.socket.on('job-status', (data) => {
            this.emit('job-status-response', data);
        });

        // ✅ NOUVEAU: Gestion du pong
        this.socket.on('pong', (data) => {
            this.logger.debug('Pong reçu', data);
        });
    }

    /**
     * ✅ NOUVEAU: Valider les données de job
     */
    validateJobData(data, requiredFields) {
        if (!data || typeof data !== 'object') {
            this.logger.warn('Données job invalides:', data);
            return false;
        }

        for (const field of requiredFields) {
            if (!data[field]) {
                this.logger.warn(`Champ requis manquant: ${field}`, data);
                return false;
            }
        }

        return true;
    }

    /**
     * ✅ NOUVEAU: Démarrer le ping périodique
     */
    startPingInterval() {
        this.stopPingInterval(); // Arrêter l'ancien intervalle
        
        this.pingInterval = setInterval(() => {
            if (this.isConnected && this.socket) {
                try {
                    this.socket.emit('ping', Date.now());
                } catch (error) {
                    this.logger.warn('Erreur ping:', error);
                }
            }
        }, 30000); // Ping toutes les 30 secondes
    }

    /**
     * ✅ NOUVEAU: Arrêter le ping périodique
     */
    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Programmer une reconnexion
     */
    scheduleReconnect() {
        if (this.isDestroyed) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error('Nombre maximum de tentatives de reconnexion atteint');
            this.emit('max-reconnect-attempts');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            30000 // Maximum 30 secondes
        );

        this.logger.info(`Reconnexion dans ${delay}ms (tentative ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            if (!this.isConnected && !this.isConnecting && !this.isDestroyed) {
                this.connect();
            }
        }, delay);
    }

    /**
     * Rejoindre les rooms après reconnexion
     */
    rejoinRooms() {
        if (this.joinedRooms.size === 0) return;

        this.logger.info(`Rejoindre ${this.joinedRooms.size} room(s)`);
        
        this.joinedRooms.forEach(room => {
            if (room.startsWith('job-')) {
                const jobId = room.replace('job-', '');
                this.joinJobRoom(jobId);
            }
        });
    }

    /**
     * Rejoindre la room d'un job pour recevoir les updates
     */
    joinJobRoom(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            this.logger.warn('Job ID invalide pour join room:', jobId);
            return;
        }

        if (!this.isConnected) {
            this.logger.warn('Impossible de rejoindre room, WebSocket non connecté');
            // ✅ FIX: Ajouter à la liste pour rejoindre après connexion
            this.joinedRooms.add(`job-${jobId}`);
            return;
        }

        try {
            this.socket.emit('join-job', jobId);
            this.logger.debug('Demande rejoindre room job:', jobId);
        } catch (error) {
            this.logger.error('Erreur join room:', error);
        }
    }

    /**
     * Quitter la room d'un job
     */
    leaveJobRoom(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            this.logger.warn('Job ID invalide pour leave room:', jobId);
            return;
        }

        if (!this.isConnected) {
            this.joinedRooms.delete(`job-${jobId}`);
            return;
        }

        try {
            this.socket.emit('leave-job', jobId);
            this.joinedRooms.delete(`job-${jobId}`);
            this.logger.debug('Quitté room job:', jobId);
        } catch (error) {
            this.logger.error('Erreur leave room:', error);
        }
    }

    /**
     * Demander le statut d'un job
     */
    requestJobStatus(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            this.logger.warn('Job ID invalide pour request status:', jobId);
            return;
        }

        if (!this.isConnected) {
            this.logger.warn('Impossible de demander statut, WebSocket non connecté');
            return;
        }

        try {
            this.socket.emit('get-status', jobId);
            this.logger.debug('Demande statut job:', jobId);
        } catch (error) {
            this.logger.error('Erreur request status:', error);
        }
    }

    /**
     * Envoyer un ping au serveur
     */
    ping() {
        if (!this.isConnected) {
            return Promise.reject(new Error('WebSocket non connecté'));
        }

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            // ✅ FIX: Timeout plus court et gestion d'erreur
            const timeoutId = setTimeout(() => {
                reject(new Error('Ping timeout (5s)'));
            }, 5000);

            try {
                this.socket.emit('ping', startTime, (response) => {
                    clearTimeout(timeoutId);
                    const latency = Date.now() - startTime;
                    resolve({ latency, serverTime: response });
                });
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }

    /**
     * S'abonner à un type d'événement
     */
    on(event, handler) {
        if (!event || typeof handler !== 'function') {
            this.logger.warn('Paramètres invalides pour on():', { event, handler });
            return;
        }

        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
        
        this.logger.debug(`Handler ajouté pour événement: ${event}`);
    }

    /**
     * Se désabonner d'un événement
     */
    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(handler);
            
            // ✅ FIX: Nettoyer les ensembles vides
            if (this.eventHandlers.get(event).size === 0) {
                this.eventHandlers.delete(event);
            }
        }
    }

    /**
     * Émettre un événement vers les handlers locaux
     */
    emit(event, data) {
        if (!this.eventHandlers.has(event)) return;

        const handlers = this.eventHandlers.get(event);
        
        // ✅ FIX: Gestion d'erreur pour chaque handler
        handlers.forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                this.logger.error(`Erreur handler événement ${event}:`, {
                    error: error.message,
                    stack: error.stack
                });
                
                // ✅ NOUVEAU: Retirer les handlers défaillants
                if (error.message.includes('Maximum call stack')) {
                    this.logger.warn(`Handler défaillant retiré pour ${event}`);
                    handlers.delete(handler);
                }
            }
        });
    }

    /**
     * Envoyer un événement au serveur
     */
    send(event, data) {
        if (!event || typeof event !== 'string') {
            this.logger.warn('Nom d\'événement invalide:', event);
            return false;
        }

        if (!this.isConnected) {
            this.logger.warn(`Impossible d'envoyer ${event}, WebSocket non connecté`);
            return false;
        }

        try {
            this.socket.emit(event, data);
            this.logger.debug(`Événement envoyé: ${event}`, data);
            return true;
        } catch (error) {
            this.logger.error(`Erreur envoi événement ${event}:`, error);
            return false;
        }
    }

    /**
     * Déconnexion manuelle
     */
    disconnect() {
        this.logger.info('Déconnexion manuelle WebSocket');
        
        this.stopPingInterval();
        
        if (this.socket) {
            try {
                this.socket.disconnect();
            } catch (error) {
                this.logger.error('Erreur déconnexion:', error);
            }
        }
        
        this.isConnected = false;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.joinedRooms.clear();
    }

    /**
     * Reconnexion manuelle
     */
    reconnect() {
        this.logger.info('Reconnexion manuelle demandée');
        
        this.disconnect();
        
        setTimeout(() => {
            this.reconnectAttempts = 0;
            this.connect();
        }, 1000);
    }

    /**
     * Obtenir l'état de la connexion
     */
    getConnectionState() {
        return {
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            reconnectAttempts: this.reconnectAttempts,
            connectionAttempts: this.connectionAttempts,
            socketId: this.socket?.id,
            joinedRooms: Array.from(this.joinedRooms),
            transport: this.socket?.io?.engine?.transport?.name,
            lastConnectionTime: this.lastConnectionTime,
            uptime: this.lastConnectionTime ? Date.now() - this.lastConnectionTime : 0
        };
    }

    /**
     * Obtenir les statistiques de connexion
     */
    getStats() {
        if (!this.socket) {
            return { 
                connected: false,
                error: 'Socket non initialisé'
            };
        }

        const state = this.getConnectionState();
        
        return {
            connected: this.isConnected,
            socketId: this.socket.id,
            transport: this.socket.io?.engine?.transport?.name,
            reconnectAttempts: this.reconnectAttempts,
            connectionAttempts: this.connectionAttempts,
            joinedRooms: this.joinedRooms.size,
            eventHandlers: this.eventHandlers.size,
            uptime: state.uptime,
            url: this.baseUrl
        };
    }

    /**
     * Activer/désactiver le mode debug
     */
    setDebugMode(enabled) {
        try {
            if (this.socket && this.socket.io) {
                // ✅ FIX: Vérifier si la méthode debug existe
                if (typeof this.socket.io.debug === 'function') {
                    this.socket.io.debug(enabled);
                }
            }
            this.logger.info(`Mode debug WebSocket: ${enabled ? 'activé' : 'désactivé'}`);
        } catch (error) {
            this.logger.warn('Impossible de changer le mode debug:', error);
        }
    }

    /**
     * Nettoyer les ressources
     */
    destroy() {
        this.logger.info('Destruction WebSocketManager');
        
        this.isDestroyed = true;
        this.stopPingInterval();
        
        // Nettoyer les handlers d'événements
        this.eventHandlers.clear();
        this.joinedRooms.clear();
        
        if (this.socket) {
            try {
                this.socket.removeAllListeners();
                this.socket.disconnect();
            } catch (error) {
                this.logger.error('Erreur destruction socket:', error);
            }
            this.socket = null;
        }
        
        this.isConnected = false;
        this.isConnecting = false;
    }

    /**
     * Test de fonctionnalité WebSocket
     */
    async testConnection() {
        try {
            if (!this.isConnected) {
                throw new Error('WebSocket non connecté');
            }

            // Test ping
            const pingResult = await this.ping();
            
            // Test join/leave room
            const testJobId = 'test-' + Date.now();
            this.joinJobRoom(testJobId);
            
            await new Promise(resolve => setTimeout(resolve, 100));
            this.leaveJobRoom(testJobId);

            return {
                success: true,
                latency: pingResult.latency,
                features: {
                    ping: true,
                    rooms: true,
                    events: true
                },
                stats: this.getStats()
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                stats: this.getStats()
            };
        }
    }

    /**
     * Middleware pour retry automatique des événements critiques
     */
    sendWithRetry(event, data, maxRetries = 3) {
        if (!event || typeof event !== 'string') {
            return Promise.reject(new Error('Nom d\'événement invalide'));
        }

        return new Promise((resolve, reject) => {
            let attempts = 0;

            const attemptSend = () => {
                attempts++;

                if (!this.isConnected) {
                    if (attempts < maxRetries) {
                        // ✅ FIX: Délai progressif
                        const delay = Math.min(1000 * attempts, 5000);
                        setTimeout(attemptSend, delay);
                        return;
                    }
                    reject(new Error('WebSocket non connecté après plusieurs tentatives'));
                    return;
                }

                try {
                    this.socket.emit(event, data, (response) => {
                        if (response && response.success) {
                            resolve(response);
                        } else if (attempts < maxRetries) {
                            const delay = Math.min(1000 * attempts, 5000);
                            setTimeout(attemptSend, delay);
                        } else {
                            reject(new Error(response?.error || 'Erreur envoi événement'));
                        }
                    });
                } catch (error) {
                    if (attempts < maxRetries) {
                        const delay = Math.min(1000 * attempts, 5000);
                        setTimeout(attemptSend, delay);
                    } else {
                        reject(error);
                    }
                }
            };

            attemptSend();
        });
    }

    /**
     * ✅ NOUVEAU: Vérifier la santé de la connexion
     */
    async healthCheck() {
        const state = this.getConnectionState();
        
        if (!this.isConnected) {
            return {
                healthy: false,
                status: 'disconnected',
                reconnectAttempts: this.reconnectAttempts,
                lastError: 'Non connecté'
            };
        }

        try {
            const pingResult = await this.ping();
            
            return {
                healthy: true,
                status: 'connected',
                latency: pingResult.latency,
                uptime: state.uptime,
                transport: state.transport,
                joinedRooms: state.joinedRooms.length
            };
        } catch (error) {
            return {
                healthy: false,
                status: 'connected_but_unresponsive',
                error: error.message,
                uptime: state.uptime
            };
        }
    }

    /**
     * ✅ NOUVEAU: Forcer la reconnexion en cas de problème
     */
    forceReconnect() {
        this.logger.warn('Reconnexion forcée demandée');
        
        // Réinitialiser les compteurs
        this.reconnectAttempts = 0;
        this.connectionAttempts = 0;
        
        // Fermer proprement et reconnecter
        this.disconnect();
        
        setTimeout(() => {
            this.connect();
        }, 500);
    }

    /**
     * ✅ NOUVEAU: Obtenir les métriques de performance
     */
    getPerformanceMetrics() {
        const state = this.getConnectionState();
        
        return {
            connectionSuccess: this.connectionAttempts > 0 ? 
                (this.connectionAttempts - this.reconnectAttempts) / this.connectionAttempts : 0,
            averageReconnectTime: this.reconnectAttempts > 0 ? 
                this.reconnectDelay * (Math.pow(2, this.reconnectAttempts) - 1) / this.reconnectAttempts : 0,
            uptime: state.uptime,
            totalEvents: Array.from(this.eventHandlers.values())
                .reduce((sum, handlers) => sum + handlers.size, 0),
            roomsJoined: this.joinedRooms.size,
            lastActivity: this.lastConnectionTime
        };
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketManager;
} else {
    window.WebSocketManager = WebSocketManager;
}