// ecosystem.config.js
// Configuration PM2 pour production et déploiement

module.exports = {
  apps: [
    {
      name: 'file-optimizer-api',
      script: 'src/server.js',
      cwd: '/opt/file-optimizer/backend',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 8000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8000,
        LOG_LEVEL: 'info',
        REDIS_URL: 'redis://localhost:6379',
        TEMP_DIR: '/opt/file-optimizer/uploads',
        LOG_DIR: '/opt/file-optimizer/logs'
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 8001,
        LOG_LEVEL: 'debug',
        REDIS_URL: 'redis://localhost:6379',
        TEMP_DIR: '/opt/file-optimizer-staging/uploads'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/opt/file-optimizer/logs/pm2-api-error.log',
      out_file: '/opt/file-optimizer/logs/pm2-api-out.log',
      log_file: '/opt/file-optimizer/logs/pm2-api-combined.log',
      merge_logs: true,
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=1024',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 8000,
      kill_timeout: 5000,
      wait_ready: true,
      autorestart: true,
      watch: false,
      ignore_watch: ['logs', 'uploads', 'tmp', 'node_modules'],
      source_map_support: false,
      instance_var: 'INSTANCE_ID'
    },
    {
      name: 'file-optimizer-worker',
      script: 'src/workers/processor.js',
      cwd: '/opt/file-optimizer/backend',
      instances: 2,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_CONCURRENCY: 2
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        WORKER_CONCURRENCY: 2,
        JOB_TIMEOUT: 1800,
        REDIS_URL: 'redis://localhost:6379',
        TEMP_DIR: '/opt/file-optimizer/uploads'
      },
      env_staging: {
        NODE_ENV: 'staging',
        LOG_LEVEL: 'debug',
        WORKER_CONCURRENCY: 1,
        REDIS_URL: 'redis://localhost:6379'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/opt/file-optimizer/logs/pm2-worker-error.log',
      out_file: '/opt/file-optimizer/logs/pm2-worker-out.log',
      log_file: '/opt/file-optimizer/logs/pm2-worker-combined.log',
      merge_logs: true,
      max_memory_restart: '2G',
      node_args: '--max-old-space-size=2048',
      restart_delay: 10000,
      max_restarts: 5,
      min_uptime: '30s',
      kill_timeout: 30000,
      autorestart: true,
      watch: false,
      ignore_watch: ['logs', 'uploads', 'tmp', 'node_modules']
    }
  ],

  deploy: {
    production: {
      user: 'deploy',
      host: ['server1.example.com', 'server2.example.com'],
      ref: 'origin/main',
      repo: 'https://github.com/your-username/file-optimizer.git',
      path: '/opt/file-optimizer',
      'pre-deploy-local': '',
      'post-deploy': 'cd backend && npm ci --only=production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /opt/file-optimizer/logs /opt/file-optimizer/uploads',
      'ssh_options': 'ForwardAgent=yes',
      env: {
        NODE_ENV: 'production'
      }
    },
    staging: {
      user: 'deploy',
      host: 'staging.example.com',
      ref: 'origin/develop',
      repo: 'https://github.com/your-username/file-optimizer.git',
      path: '/opt/file-optimizer-staging',
      'post-deploy': 'cd backend && npm ci && pm2 reload ecosystem.config.js --env staging',
      'pre-setup': 'mkdir -p /opt/file-optimizer-staging/logs /opt/file-optimizer-staging/uploads',
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
};