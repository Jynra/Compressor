// js/api.js
// Client API REST pour File Optimizer

/**
 * Client API REST avec retry automatique et cache intelligent
 */
class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.logger = Utils.createLogger('ApiClient');
        this.defaultTimeout = 30000; // 30 secondes
        this.pendingRequests = new Map(); // Éviter les doublons
    }

    /**
     * Requête HTTP générique avec retry automatique
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        
        // Générer une clé pour éviter les requêtes en doublon
        const requestKey = `${options.method || 'GET'}:${url}:${JSON.stringify(options.body || {})}`;
        
        // Si requête déjà en cours, attendre le résultat
        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }

        const requestPromise = this._executeRequest(url, options);
        this.pendingRequests.set(requestKey, requestPromise);

        try {
            const result = await requestPromise;
            return result;
        } finally {
            this.pendingRequests.delete(requestKey);
        }
    }

    /**
     * Exécuter la requête HTTP
     */
    async _executeRequest(url, options = {}) {
        const config = {
            timeout: this.defaultTimeout,
            headers: {
                ...options.headers
            },
            ...options
        };

        // ✅ FIX: Ne pas définir Content-Type pour FormData
        if (config.body && !(config.body instanceof FormData)) {
            config.headers['Content-Type'] = 'application/json';
        }

        // Vérifier le cache pour GET
        if (options.method === 'GET' || !options.method) {
            const cached = this.getFromCache(url);
            if (cached) {
                return cached;
            }
        }

        return Utils.retry(async (attempt) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            try {
                this.logger.debug(`Requête ${options.method || 'GET'} ${url} (tentative ${attempt})`);

                const response = await fetch(url, {
                    ...config,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // ✅ FIX: Gestion d'erreurs plus détaillée
                if (!response.ok) {
                    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                    
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorMessage;
                    } catch (parseError) {
                        // Ignore les erreurs de parsing, garder le message HTTP
                    }
                    
                    throw new Error(errorMessage);
                }

                // ✅ FIX: Vérifier si la réponse contient du JSON
                const contentType = response.headers.get('content-type');
                let data;
                
                if (contentType && contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    // Pour les réponses non-JSON (ex: téléchargements)
                    data = {
                        success: true,
                        data: await response.text(),
                        headers: Object.fromEntries(response.headers.entries())
                    };
                }
                
                // Mettre en cache les GET réussis (seulement JSON)
                if ((!options.method || options.method === 'GET') && contentType?.includes('json')) {
                    this.setCache(url, data);
                }

                return data;
            } catch (error) {
                clearTimeout(timeoutId);
                
                if (error.name === 'AbortError') {
                    throw new Error(`Timeout de requête (${config.timeout}ms)`);
                }
                
                // ✅ FIX: Log des erreurs avec contexte
                this.logger.warn(`Erreur requête ${url}:`, {
                    message: error.message,
                    attempt,
                    method: options.method || 'GET'
                });
                
                throw error;
            }
        }, 3, 1000);
    }

    /**
     * Upload de fichier avec progression
     */
    async uploadFile(file, settings = {}) {
        try {
            // ✅ FIX: Validation des paramètres
            if (!file || !file.name) {
                throw new Error('Fichier invalide');
            }

            if (file.size === 0) {
                throw new Error('Fichier vide');
            }

            this.logger.info(`Upload fichier: ${file.name} (${Utils.formatFileSize(file.size)})`);
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('settings', JSON.stringify(settings));

            // ✅ FIX: Utiliser la méthode request avec timeout spécifique
            const uploadTimeout = Math.max(30000, file.size / 10000); // Au moins 30s, plus pour gros fichiers
            
            const response = await fetch(`${this.baseUrl}/upload`, {
                method: 'POST',
                body: formData,
                // ✅ FIX: Pas de Content-Type header pour FormData !
                signal: AbortSignal.timeout(uploadTimeout)
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch {
                    errorMessage = response.statusText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            
            // ✅ FIX: Validation de la réponse
            if (!result.jobId) {
                throw new Error('Réponse invalide du serveur (jobId manquant)');
            }

            this.logger.info(`Upload réussi: ${result.jobId}`);
            
            return result;
        } catch (error) {
            this.logger.error('Erreur upload:', {
                fileName: file?.name,
                fileSize: file?.size,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Récupérer les jobs avec pagination
     */
    async getJobs(params = {}) {
        // ✅ FIX: Validation et nettoyage des paramètres
        const cleanParams = {
            page: Math.max(1, parseInt(params.page) || 1),
            limit: Math.min(100, Math.max(1, parseInt(params.limit) || 20)),
            sortBy: ['createdAt', 'updatedAt', 'size', 'status'].includes(params.sortBy) 
                ? params.sortBy : 'createdAt',
            sortOrder: ['asc', 'desc'].includes(params.sortOrder) 
                ? params.sortOrder : 'desc'
        };

        // Ajouter les filtres optionnels
        if (params.status) cleanParams.status = params.status;
        if (params.type) cleanParams.type = params.type;
        if (params.dateFrom) cleanParams.dateFrom = params.dateFrom;
        if (params.dateTo) cleanParams.dateTo = params.dateTo;

        const query = new URLSearchParams(cleanParams);
        return this.request(`/status?${query}`);
    }

    /**
     * Récupérer un job spécifique
     */
    async getJob(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            throw new Error('Job ID invalide');
        }
        return this.request(`/status/${jobId}`);
    }

    /**
     * Supprimer un job
     */
    async deleteJob(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            throw new Error('Job ID invalide');
        }
        return this.request(`/status/${jobId}`, { method: 'DELETE' });
    }

    /**
     * Relancer un job en erreur
     */
    async retryJob(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            throw new Error('Job ID invalide');
        }
        return this.request(`/status/${jobId}/retry`, { method: 'POST' });
    }

    /**
     * Annuler un job
     */
    async cancelJob(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            throw new Error('Job ID invalide');
        }
        return this.request(`/process/${jobId}/cancel`, { method: 'POST' });
    }

    /**
     * Démarrer le traitement d'un job
     */
    async startProcessing(jobId, settings = {}) {
        if (!jobId || typeof jobId !== 'string') {
            throw new Error('Job ID invalide');
        }
        
        return this.request(`/process/${jobId}`, {
            method: 'POST',
            body: JSON.stringify({ settings })
        });
    }

    /**
     * Récupérer les informations d'upload
     */
    async getUploadInfo() {
        return this.request('/upload/info');
    }

    /**
     * Récupérer les statistiques
     */
    async getStats() {
        return this.request('/status/stats/global');
    }

    /**
     * Health check
     */
    async healthCheck() {
        return this.request('/health');
    }

    /**
     * ✅ NOUVEAU: Télécharger un fichier
     */
    async downloadFile(jobId) {
        if (!jobId || typeof jobId !== 'string') {
            throw new Error('Job ID invalide');
        }

        try {
            const response = await fetch(`${this.baseUrl}/download/${jobId}`, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`Téléchargement échoué: ${response.status}`);
            }

            return response.blob();
        } catch (error) {
            this.logger.error('Erreur téléchargement:', error);
            throw error;
        }
    }

    /**
     * Gestion du cache
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            this.logger.debug(`Cache hit: ${key}`);
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }

    setCache(key, data) {
        // ✅ FIX: Limiter la taille du cache
        if (this.cache.size >= 100) {
            // Supprimer les entrées les plus anciennes
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.cache.clear();
        this.logger.info('Cache vidé');
    }

    /**
     * ✅ NOUVEAU: Nettoyer les caches expirés
     */
    cleanExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * ✅ NOUVEAU: Obtenir les statistiques du client
     */
    getClientStats() {
        return {
            cacheSize: this.cache.size,
            pendingRequests: this.pendingRequests.size,
            baseUrl: this.baseUrl,
            defaultTimeout: this.defaultTimeout
        };
    }

    /**
     * ✅ NOUVEAU: Vérifier la connectivité
     */
    async checkConnectivity() {
        try {
            const start = Date.now();
            await this.healthCheck();
            const latency = Date.now() - start;
            
            return {
                online: true,
                latency,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                online: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * ✅ NOUVEAU: Destructor pour nettoyer les ressources
     */
    destroy() {
        this.clearCache();
        this.pendingRequests.clear();
        this.logger.info('ApiClient détruit');
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ApiClient;
} else {
    window.ApiClient = ApiClient;
}