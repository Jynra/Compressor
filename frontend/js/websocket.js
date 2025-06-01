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
        
        this.connect();
    }

    /**
     * Établir la connexion WebSocket
     */
    connect() {
        if (this.isConnecting || this.isConnected) {
            return;
        }

        try {
            this.isConnecting = true;
            this.logger.info('Connexion WebSocket...');

            // Initialiser Socket.IO
            this.socket = io(this.baseUrl, {
                transports: ['websocket', 'polling'],
                timeout: 20000,
                reconnection: false, // Gestion manuelle
                forceNew: true
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
        // Connexion établie
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            
            this.logger.info('WebSocket connecté', { id: this.socket.id });
            this.emit('connect');

            // Rejoindre les rooms précédemment jointes
            this.rejoinRooms();
        });

        // Déconnexion
        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            this.logger.warn('WebSocket déconnecté:', reason);
            this.emit('disconnect', reason);

            // Reconnexion automatique sauf si déconnexion volontaire
            if (reason !== 'io client disconnect') {
                this.scheduleReconnect();
            }
        });

        // Erreur de connexion
        this.socket.on('connect_error', (error) => {
            this.isConnecting = false;
            this.logger.error('Erreur connexion WebSocket:', error);
            this.emit('error', error);
            this.scheduleReconnect();
        });

        // Événements métier
        this.socket.on('job-progress', (data) => {
            this.logger.debug('Progression job:', data);
            this.emit('job-progress', data);
        });

        this.socket.on('job-completed', (data) => {
            this.logger.info('Job terminé:', data.jobId);
            this.emit('job-completed', data);
        });

        this.socket.on('job-error', (data) => {
            this.logger.error('Erreur job:', data);
            this.emit('job-error', data);
        });

        this.socket.on('job-queued', (data) => {
            this.logger.info('Job en queue:', data.jobId);
            this.emit('job-queued', data);
        });

        this.socket.on('job-started', (data) => {
            this.logger.info('Job démarré:', data.jobId);
            this.emit('job-started', data);
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
            this.joinedRooms.add(`job-${data.jobId}`);
            this.logger.debug('Rejoint room job:', data.jobId);
        });

        this.socket.on('left-job', (data) => {
            this.joinedRooms.delete(`job-${data.jobId}`);
            this.logger.debug('Quitté room job:', data.jobId);
        });

        this.socket.on('job-status', (data) => {
            this.emit('job-status-response', data);
        });

        // Événements d'erreur spécifiques
        this.socket.on('error', (data) => {
            this.logger.error('Erreur WebSocket:', data);
            this.emit('websocket-error', data);
        });
    }

    /**
     * Programmer une reconnexion
     */
    scheduleReconnect() {
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
            if (!this.isConnected && !this.isConnecting) {
                this.connect();
            }
        }, delay);
    }

    /**
     * Rejoindre les rooms après reconnexion
     */
    rejoinRooms() {
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
        if (!this.isConnected) {
            this.logger.warn('Impossible de rejoindre room, WebSocket non connecté');
            return;
        }

        this.socket.emit('join-job', jobId);
        this.logger.debug('Demande rejoindre room job:', jobId);
    }

    /**
     * Quitter la room d'un job
     */
    leaveJobRoom(jobId) {
        if (!this.isConnected) {
            return;
        }

        this.socket.emit('leave-job', jobId);
        this.joinedRooms.delete(`job-${jobId}`);
        this.logger.debug('Quitté room job:', jobId);
    }

    /**
     * Demander le statut d'un job
     */
    requestJobStatus(jobId) {
        if (!this.isConnected) {
            this.logger.warn('Impossible de demander statut, WebSocket non connecté');
            return;
        }

        this.socket.emit('get-status', jobId);
        this.logger.debug('Demande statut job:', jobId);
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
            
            this.socket.emit('ping', startTime, (response) => {
                const latency = Date.now() - startTime;
                resolve({ latency, serverTime: response });
            });

            // Timeout après 5 secondes
            setTimeout(() => {
                reject(new Error('Ping timeout'));
            }, 5000);
        });
    }

    /**
     * S'abonner à un type d'événement
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
    }

    /**
     * Se désabonner d'un événement
     */
    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(handler);
        }
    }

    /**
     * Émettre un événement vers les handlers locaux
     */
    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.logger.error(`Erreur handler événement ${event}:`, error);
                }
            });
        }
    }

    /**
     * Envoyer un événement au serveur
     */
    send(event, data) {
        if (!this.isConnected) {
            this.logger.warn(`Impossible d'envoyer ${event}, WebSocket non connecté`);
            return;
        }

        this.socket.emit(event, data);
    }

    /**
     * Déconnexion manuelle
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.isConnected = false;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.joinedRooms.clear();
        
        this.logger.info('WebSocket déconnecté manuellement');
    }

    /**
     * Reconnexion manuelle
     */
    reconnect() {
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
            socketId: this.socket?.id,
            joinedRooms: Array.from(this.joinedRooms),
            transport: this.socket?.io?.engine?.transport?.name
        };
    }

    /**
     * Obtenir les statistiques de connexion
     */
    getStats() {
        if (!this.socket) {
            return { connected: false };
        }

        return {
            connected: this.isConnected,
            socketId: this.socket.id,
            transport: this.socket.io.engine.transport.name,
            reconnectAttempts: this.reconnectAttempts,
            joinedRooms: this.joinedRooms.size,
            eventHandlers: this.eventHandlers.size
        };
    }

    /**
     * Activer/désactiver le mode debug
     */
    setDebugMode(enabled) {
        if (this.socket) {
            this.socket.debug(enabled);
        }
    }

    /**
     * Nettoyer les ressources
     */
    destroy() {
        this.eventHandlers.clear();
        this.joinedRooms.clear();
        
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
        }
        
        this.logger.info('WebSocketManager détruit');
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
            this.joinJobRoom('test-job-id');
            await new Promise(resolve => setTimeout(resolve, 100));
            this.leaveJobRoom('test-job-id');

            return {
                success: true,
                latency: pingResult.latency,
                features: {
                    ping: true,
                    rooms: true,
                    events: true
                }
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Middleware pour retry automatique des événements critiques
     */
    sendWithRetry(event, data, maxRetries = 3) {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const attemptSend = () => {
                attempts++;

                if (!this.isConnected) {
                    if (attempts < maxRetries) {
                        setTimeout(attemptSend, 1000 * attempts);
                        return;
                    }
                    reject(new Error('WebSocket non connecté après plusieurs tentatives'));
                    return;
                }

                this.socket.emit(event, data, (response) => {
                    if (response && response.success) {
                        resolve(response);
                    } else if (attempts < maxRetries) {
                        setTimeout(attemptSend, 1000 * attempts);
                    } else {
                        reject(new Error(response?.error || 'Erreur envoi événement'));
                    }
                });
            };

            attemptSend();
        });
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketManager;
} else {
    window.WebSocketManager = WebSocketManager;
}