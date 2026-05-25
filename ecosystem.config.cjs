const path = require("node:path");
const ROOT = __dirname;

function agentApp(label, pkg) {
  return {
    name: `forum-${label}`,
    cwd: ROOT,
    script: `examples/${pkg}/src/index.ts`,
    interpreter: "node",
    interpreter_args: "--import tsx",
    node_args: "--env-file=.env",
    out_file: path.join(ROOT, "logs", `agent-${label}.out.log`),
    error_file: path.join(ROOT, "logs", `agent-${label}.err.log`),
    time: true,
  };
}

module.exports = {
  apps: [
    {
      name: "forum-market-api",
      cwd: ROOT,
      script: "apps/market-api/dist/index.js",
      node_args: "--env-file=.env",
      out_file: path.join(ROOT, "logs", "market-api.out.log"),
      error_file: path.join(ROOT, "logs", "market-api.err.log"),
      time: true,
    },
    {
      name: "forum-resolver",
      cwd: ROOT,
      script: "apps/resolver/dist/index.js",
      node_args: "--env-file=.env",
      out_file: path.join(ROOT, "logs", "resolver.out.log"),
      error_file: path.join(ROOT, "logs", "resolver.err.log"),
      time: true,
    },
    {
      name: "forum-console",
      cwd: path.join(ROOT, "apps/console"),
      script: "node_modules/.bin/next",
      args: "start --port ${CONSOLE_PORT:-8404}",
      node_args: "--env-file=../../.env",
      out_file: path.join(ROOT, "logs", "console.out.log"),
      error_file: path.join(ROOT, "logs", "console.err.log"),
      time: true,
    },
    agentApp("scout", "forum-scout"),
    agentApp("translator", "forum-translator"),
    agentApp("keeper", "forum-keeper"),
  ],
};
