module.exports = {
  apps: [
    {
      name: 'amora-bet-api',
      cwd: '/var/www/amora-bet',
      script: 'server/index.mjs',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      restart_delay: 2500,
      max_restarts: 20,
      min_uptime: '10s',
      kill_timeout: 10000,
      listen_timeout: 12000,
      merge_logs: true,
      time: true,
      out_file: '/var/log/amora-bet/api-out.log',
      error_file: '/var/log/amora-bet/api-error.log',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 8787,
        DOTFY_API_KEY: 'vk_live_fpDlX1q2ak6MnItVEttrMFgPXrSGjdVDjQOkSIXUhoA',
        DOTFY_SPLIT_ENABLED: 'false'
      }
    }
  ]
};
