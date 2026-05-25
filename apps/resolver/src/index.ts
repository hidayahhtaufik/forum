import { loadEnv } from "./env.js";
import { loadDeployment } from "./deployment.js";
import { runWorker } from "./worker.js";

async function main() {
  const env = loadEnv();
  const deployment = loadDeployment();

  if (deployment.chainId !== env.ARC_CHAIN_ID) {
    throw new Error(
      `chain mismatch: deployment.chainId=${deployment.chainId} vs ARC_CHAIN_ID=${env.ARC_CHAIN_ID}`,
    );
  }

  const { stop } = await runWorker(env, deployment);

  const shutdown = () => {
    console.log("[resolver] shutting down");
    stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[resolver] fatal:", err);
  process.exit(1);
});
