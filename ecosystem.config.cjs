/**
 * PM2 processes for aaPanel (or any Linux server). See docs/DEPLOY-AAPANEL.md.
 *   pm2 start ecosystem.config.cjs      # first time
 *   pm2 reload ecosystem.config.cjs     # after a deploy (zero-downtime for the web app)
 * Both apps read the project's .env.local (git-ignored; created on the server from deploy/env.staging.example).
 */
const path = require("node:path");

const root = __dirname;
const envFile = path.join(root, ".env.local");
const port = process.env.PORT || "3000";

module.exports = {
  apps: [
    {
      name: "indinite-web",
      cwd: path.join(root, "apps/web"),
      script: "node_modules/next/dist/bin/next",
      // Only reachable from the server itself; Nginx (aaPanel reverse proxy) faces the internet.
      args: `start -p ${port} -H 127.0.0.1`,
      node_args: `--env-file=${envFile}`,
      env: { NODE_ENV: "production" },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
      kill_timeout: 10000,
      time: true,
      out_file: path.join(root, "logs/web.out.log"),
      error_file: path.join(root, "logs/web.err.log"),
    },
    {
      name: "indinite-worker",
      cwd: path.join(root, "apps/worker"),
      script: "src/index.ts",
      // tsx runs the TypeScript worker directly (same code as development).
      node_args: `--env-file=${envFile} --import tsx`,
      env: { NODE_ENV: "production" },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      // Lets in-flight emails finish (the worker waits up to 30 s on SIGINT).
      kill_timeout: 35000,
      time: true,
      out_file: path.join(root, "logs/worker.out.log"),
      error_file: path.join(root, "logs/worker.err.log"),
    },
  ],
};
