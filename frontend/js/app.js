// js/app.js
// Application principale File Optimizer

/**
 * Classe principale de l'application File Optimizer
 */
class FileOptimizer {
    constructor() {
        this.jobs = new Map();
        this.socket = null;
        this.api = null;
        this.ui = null;
        this.websocket.on('job-progress', (data) => {
            this.updateJobProgress(data.jobId, data.progress);
        });

        this.websocket.on('job-completed', (data) => {
            this.updateJobStatus(data.jobId, 'completed', data);
        });

        this.websocket.on('job-error', (data) => {
            this.updateJobStatus(data.jobId, 'error', { error: data.error });
        });

        this.websocket.on('job-queued', (data) => {
            this.updateJobStatus(data.jobId, 'queued');
        });
    }

    /**
     * Gestion drag & drop
     */
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.setUploadZoneState('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.setUploadZoneState('normal');
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.setUploadZoneState('normal');
        
        const files = Array.from(e.dataTransfer.files);
        this.handleFiles(files);
    }

    /**
     * Traitement des fichiers sélectionnés
     */
    async handleFiles(files) {
        if (files.length === 0) return;

        console.log(`📁 ${files.length} fichier(s) sélectionné(s)`);
        
        // Valider les fichiers
        const validFiles = files.filter(file => this.validateFile(file));
        
        if (validFiles.length !== files.length) {
            this.ui.showStatus(
                `${files.length - validFiles.length} fichier(s) rejeté(s) (type non supporté ou trop volumineux)`,
                'warning'
            );
        }

        // Traiter les fichiers valides
        for (const file of validFiles) {
            try {
                await this.uploadFile(file);
            } catch (error) {
                console.error(`Erreur upload ${file.name}:`, error);
            }
        }
    }

    /**
     * Validation d'un fichier
     */
    validateFile(file) {
        // Vérifier la taille
        if (file.size > this.config.maxFileSize) {
            console.warn(`Fichier trop volumineux: ${file.name} (${Utils.formatFileSize(file.size)})`);
            return false;
        }

        // Vérifier le type
        const fileType = Utils.getFileType(file.name);
        if (!this.config.supportedTypes.includes(fileType)) {
            console.warn(`Type non supporté: ${file.name} (${fileType})`);
            return false;
        }

        return true;
    }

    /**
     * Upload d'un fichier
     */
    async uploadFile(file) {
        try {
            this.ui.showStatus(`Upload de ${file.name}...`, 'info');

            // Déterminer les paramètres par défaut
            const fileType = Utils.getFileType(file.name);
            const settings = this.getDefaultSettings(fileType);

            // Créer le job temporaire
            const tempJob = {
                id: 'temp-' + Date.now(),
                name: file.name,
                size: file.size,
                type: fileType,
                status: 'uploading',
                progress: 0,
                createdAt: new Date().toISOString()
            };

            this.addJob(tempJob);

            // Upload via API
            const result = await this.api.uploadFile(file, settings);

            if (result.success) {
                // Remplacer le job temporaire par le vrai
                this.jobs.delete(tempJob.id);
                
                const job = {
                    id: result.jobId,
                    name: file.name,
                    size: file.size,
                    type: fileType,
                    status: 'uploaded',
                    progress: 0,
                    settings: settings,
                    createdAt: new Date().toISOString(),
                    estimatedTime: result.estimatedTime
                };

                this.addJob(job);
                this.websocket.joinJobRoom(result.jobId);
                
                this.ui.showStatus(`${file.name} uploadé avec succès!`, 'success');
                
            } else {
                this.jobs.delete(tempJob.id);
                throw new Error(result.error || 'Erreur upload');
            }

        } catch (error) {
            console.error('Erreur upload:', error);
            this.ui.showStatus(`Erreur upload ${file.name}: ${error.message}`, 'error');
        }
    }

    /**
     * Obtenir les paramètres par défaut selon le type
     */
    getDefaultSettings(type) {
        const defaultSettings = {
            image: {
                quality: 80,
                maxWidth: 1920,
                maxHeight: 1080,
                format: 'auto',
                removeMetadata: true
            },
            video: {
                codec: 'h264',
                crf: 23,
                preset: 'medium',
                maxBitrate: '2M'
            },
            audio: {
                codec: 'aac',
                bitrate: '128k',
                sampleRate: 44100
            },
            document: {
                compress: true,
                removeMetadata: true
            }
        };

        return defaultSettings[type] || {};
    }

    /**
     * Ajouter un job à la liste
     */
    addJob(job) {
        this.jobs.set(job.id, job);
        this.ui.renderJobs(Array.from(this.jobs.values()));
    }

    /**
     * Mettre à jour la progression d'un job
     */
    updateJobProgress(jobId, progress) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.progress = progress;
            job.status = 'processing';
            this.ui.renderJobs(Array.from(this.jobs.values()));
            
            console.log(`📊 Job ${jobId}: ${progress}%`);
        }
    }

    /**
     * Mettre à jour le statut d'un job
     */
    updateJobStatus(jobId, status, data = {}) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = status;
            Object.assign(job, data);
            this.ui.renderJobs(Array.from(this.jobs.values()));

            if (status === 'completed') {
                this.ui.showStatus(`${job.name} traité avec succès!`, 'success');
                console.log(`✅ Job ${jobId} terminé`);
            } else if (status === 'error') {
                this.ui.showStatus(`Erreur traitement ${job.name}: ${data.error}`, 'error');
                console.error(`❌ Job ${jobId} échoué:`, data.error);
            }
        }
    }

    /**
     * Supprimer un job
     */
    async deleteJob(jobId) {
        try {
            const job = this.jobs.get(jobId);
            if (!job) return;

            const confirmed = confirm(`Supprimer ${job.name} ?`);
            if (!confirmed) return;

            this.ui.setLoadingState(true);
            
            const result = await this.api.deleteJob(jobId);
            
            if (result.success) {
                this.jobs.delete(jobId);
                this.ui.renderJobs(Array.from(this.jobs.values()));
                this.ui.showStatus('Fichier supprimé', 'success');
            } else {
                throw new Error(result.error || 'Erreur suppression');
            }
        } catch (error) {
            console.error('Erreur suppression:', error);
            this.ui.showStatus('Erreur suppression: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * Retenter un job en erreur
     */
    async retryJob(jobId) {
        try {
            this.ui.setLoadingState(true);
            
            const result = await this.api.retryJob(jobId);
            
            if (result.success) {
                this.updateJobStatus(jobId, 'queued');
                this.websocket.joinJobRoom(jobId);
                this.ui.showStatus('Job relancé', 'success');
            } else {
                throw new Error(result.error || 'Erreur retry');
            }
        } catch (error) {
            console.error('Erreur retry:', error);
            this.ui.showStatus('Erreur retry: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * Charger les jobs existants
     */
    async loadExistingJobs() {
        try {
            console.log('🔄 Chargement des jobs existants...');
            
            const result = await this.api.getJobs({ limit: 50 });
            
            if (result.success && result.jobs) {
                this.jobs.clear();
                
                result.jobs.forEach(apiJob => {
                    const job = {
                        id: apiJob.id,
                        name: apiJob.originalName,
                        size: apiJob.size,
                        type: apiJob.type,
                        status: apiJob.status,
                        progress: apiJob.progress || 0,
                        createdAt: apiJob.createdAt,
                        compressedSize: apiJob.compressedSize,
                        compressionRatio: apiJob.compressionRatio,
                        error: apiJob.error
                    };
                    
                    this.jobs.set(job.id, job);
                    
                    // Rejoindre les rooms pour les jobs actifs
                    if (['queued', 'processing'].includes(job.status)) {
                        this.websocket.joinJobRoom(job.id);
                    }
                });
                
                this.ui.renderJobs(Array.from(this.jobs.values()));
                console.log(`📋 ${this.jobs.size} job(s) chargé(s)`);
            }
        } catch (error) {
            console.error('Erreur chargement jobs:', error);
            this.ui.showStatus('Erreur chargement jobs', 'error');
        }
    }

    /**
     * Charger les informations d'upload
     */
    async loadUploadInfo() {
        try {
            const info = await this.api.getUploadInfo();
            if (info.success) {
                this.config.maxFileSize = info.limits.maxFileSize;
                console.log('📊 Limites upload:', info.limits);
            }
        } catch (error) {
            console.warn('Impossible de charger les infos upload:', error);
        }
    }

    /**
     * Nettoyer les jobs terminés
     */
    async clearCompletedJobs() {
        try {
            const completedJobs = Array.from(this.jobs.values())
                .filter(job => job.status === 'completed');
            
            if (completedJobs.length === 0) {
                this.ui.showStatus('Aucun job terminé à nettoyer', 'info');
                return;
            }
            
            const confirmed = confirm(`Supprimer ${completedJobs.length} job(s) terminé(s) ?`);
            if (!confirmed) return;
            
            this.ui.setLoadingState(true);
            
            let successCount = 0;
            for (const job of completedJobs) {
                try {
                    const result = await this.api.deleteJob(job.id);
                    if (result.success) {
                        this.jobs.delete(job.id);
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Erreur suppression ${job.id}:`, error);
                }
            }
            
            this.ui.renderJobs(Array.from(this.jobs.values()));
            this.ui.showStatus(`${successCount} job(s) supprimé(s)`, 'success');
            
        } catch (error) {
            console.error('Erreur nettoyage:', error);
            this.ui.showStatus('Erreur nettoyage: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * Télécharger un fichier traité
     */
    downloadFile(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== 'completed') {
            this.ui.showStatus('Fichier non disponible pour téléchargement', 'warning');
            return;
        }

        // Créer un lien de téléchargement
        const downloadUrl = `${this.config.apiEndpoint}/download/${jobId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = job.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.ui.showStatus(`Téléchargement de ${job.name} démarré`, 'success');
    }

    /**
     * Obtenir les statistiques
     */
    getStats() {
        const jobs = Array.from(this.jobs.values());
        
        return {
            total: jobs.length,
            completed: jobs.filter(j => j.status === 'completed').length,
            processing: jobs.filter(j => j.status === 'processing').length,
            error: jobs.filter(j => j.status === 'error').length,
            totalSize: jobs.reduce((sum, j) => sum + j.size, 0),
            totalSaved: jobs
                .filter(j => j.compressedSize)
                .reduce((sum, j) => sum + (j.size - j.compressedSize), 0)
        };
    }

    /**
     * Nettoyer les ressources
     */
    destroy() {
        if (this.websocket) {
            this.websocket.disconnect();
        }
        this.jobs.clear();
        console.log('🧹 File Optimizer nettoyé');
    }
}

// Fonctions globales pour l'interface
window.fileOptimizer = null;

window.deleteJob = (jobId) => {
    if (window.fileOptimizer) {
        window.fileOptimizer.deleteJob(jobId);
    }
};

window.retryJob = (jobId) => {
    if (window.fileOptimizer) {
        window.fileOptimizer.retryJob(jobId);
    }
};

window.downloadFile = (jobId) => {
    if (window.fileOptimizer) {
        window.fileOptimizer.downloadFile(jobId);
    }
};

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 File Optimizer Frontend v2.0.0');
    window.fileOptimizer = new FileOptimizer();
});

// Nettoyage à la fermeture
window.addEventListener('beforeunload', () => {
    if (window.fileOptimizer) {
        window.fileOptimizer.destroy();
    }
}); = null;
        
        this.config = {
            maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
            supportedTypes: ['image', 'video', 'audio', 'document'],
            apiEndpoint: window.location.origin + '/api'
        };
        
        this.init();
    }

    /**
     * Initialiser l'application
     */
    async init() {
        try {
            console.log('🚀 Initialisation File Optimizer');
            
            // Initialiser les modules
            this.api = new ApiClient(this.config.apiEndpoint);
            this.ui = new UIManager();
            this.websocket = new WebSocketManager(this.config.apiEndpoint);
            
            // Configuration des événements
            this.setupEventListeners();
            this.setupWebSocketEvents();
            
            // Charger les données existantes
            await this.loadExistingJobs();
            await this.loadUploadInfo();
            
            // Marquer comme prêt
            this.ui.setLoadingState(false);
            this.ui.showStatus('Application prête', 'success');
            
            console.log('✅ File Optimizer initialisé');
            
        } catch (error) {
            console.error('❌ Erreur initialisation:', error);
            this.ui.showStatus('Erreur initialisation: ' + error.message, 'error');
        }
    }

    /**
     * Configuration des événements DOM
     */
    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const refreshJobs = document.getElementById('refreshJobs');
        const clearCompleted = document.getElementById('clearCompleted');

        // Upload zone drag & drop
        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadZone.addEventListener('drop', this.handleDrop.bind(this));

        // File input change
        fileInput.addEventListener('change', (e) => {
            this.handleFiles(Array.from(e.target.files));
        });

        // Boutons de contrôle
        if (refreshJobs) {
            refreshJobs.addEventListener('click', () => this.loadExistingJobs());
        }
        
        if (clearCompleted) {
            clearCompleted.addEventListener('click', () => this.clearCompletedJobs());
        }

        // Fermeture notifications
        document.addEventListener('click', (e) => {
            if (e.target.id === 'statusClose') {
                this.ui.hideStatus();
            }
        });

        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'u': // Ctrl+U pour upload
                        e.preventDefault();
                        fileInput.click();
                        break;
                    case 'r': // Ctrl+R pour refresh
                        if (e.shiftKey) {
                            e.preventDefault();
                            this.loadExistingJobs();
                        }
                        break;
                }
            }
        });
    }

    /**
     * Configuration des événements WebSocket
     */
    setupWebSocketEvents() {
        this.websocket.on('connect', () => {
            this.ui.setConnectionStatus(true);
            console.log('🔌 WebSocket connecté');
        });

        this.websocket.on('disconnect', () => {
            this.ui.setConnectionStatus(false);
            console.log('🔌 WebSocket déconnecté');
        });

        this.websocket