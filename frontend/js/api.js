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
    }

    /**
     * Requête HTTP générique avec retry automatique
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            timeout: this.defaultTimeout,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        // Vérifier le cache pour GET
        if (options.method === 'GET' || !options.method) {
            const cached = this.getFromCache(url);
            if (cached) {
                return cached;
            }
        }

        return Utils.retry(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            try {
                const response = await fetch(url, {
                    ...config,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                
                // Mettre en cache les GET réussis
                if (!options.method || options.method === 'GET') {
                    this.setCache(url, data);
                }

                return data;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new Error('Timeout de requête');
                }
                throw error;
            }
        }, 3, 1000);
    }

    /**
     * Upload de fichier avec progression
     */
    async uploadFile(file, settings = {}) {
        try {
            this.logger.info(`Upload fichier: ${file.name} (${Utils.formatFileSize(file.size)})`);
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('settings', JSON.stringify(settings));

            const response = await fetch(`${this.baseUrl}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            this.logger.info(`Upload réussi: ${result.jobId}`);
            
            return result;
        } catch (error) {
            this.logger.error('Erreur upload:', error);
            throw error;
        }
    }

    /**
     * Récupérer les jobs avec pagination
     */
    async getJobs(params = {}) {
        const query = new URLSearchParams({
            page: 1,
            limit: 20,
            sortBy: 'createdAt',
            sortOrder: 'desc',
            ...params
        });

        return this.request(`/status?${query}`);
    }

    /**
     * Récupérer un job spécifique
     */
    async getJob(jobId) {
        return this.request(`/status/${jobId}`);
    }

    /**
     * Supprimer un job
     */
    async deleteJob(jobId) {
        return this.request(`/status/${jobId}`, { method: 'DELETE' });
    }

    /**
     * Relancer un job en erreur
     */
    async retryJob(jobId) {
        return this.request(`/status/${jobId}/retry`, { method: 'POST' });
    }

    /**
     * Annuler un job
     */
    async cancelJob(jobId) {
        return this.request(`/process/${jobId}/cancel`, { method: 'POST' });
    }

    /**
     * Démarrer le traitement d'un job
     */
    async startProcessing(jobId, settings = {}) {
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
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.cache.clear();
        this.logger.info('Cache vidé');
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ApiClient;
} else {
    window.ApiClient = ApiClient;
}