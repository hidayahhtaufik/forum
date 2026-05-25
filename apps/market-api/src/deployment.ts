import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/// Loads the on-chain deployment manifest produced by contracts/script/Deploy.s.sol.
/// Crashes at boot if the file is missing or malformed — by design, market-api needs
/// these addresses to function.

const EvmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const DeploymentSchema = z.object({
  forexMarketImpl: EvmAddress,
  outcomeToken: EvmAddress,
  resolver: EvmAddress,
  forexMarketFactory: EvmAddress,
  agentRegistry: EvmAddress,
  resolverAdmin: EvmAddress,
  treasury: EvmAddress,
  deployer: EvmAddress,
  chainId: z.number().int(),
  blockNumber: z.number().int(),
});

export type Deployment = z.infer<typeof DeploymentSchema>;

/// Walks up from a known anchor and from process.cwd() looking for `deployments/arc-testnet.json`.
/// This lets the app boot whether invoked from the package dir (`apps/market-api/`) or repo root.
function findDeploymentPath(): string {
  const override = process.env.DEPLOYMENT_PATH;
  if (override) return resolve(process.cwd(), override);

  const candidates = [
    resolve(process.cwd(), "deployments/arc-testnet.json"),
    resolve(process.cwd(), "../../deployments/arc-testnet.json"),
    resolve(process.cwd(), "../deployments/arc-testnet.json"),
    // Last resort: relative to this source file (walk up to repo root).
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../deployments/arc-testnet.json"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!; // surface the first path in the error message
}

export function loadDeployment(path: string = findDeploymentPath()): Deployment {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read deployment manifest at ${path}. ` +
        `Run \`forge script contracts/script/Deploy.s.sol --rpc-url arc-testnet --broadcast --slow\` first ` +
        `or set DEPLOYMENT_PATH env var.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Deployment manifest at ${path} is not valid JSON: ${(err as Error).message}`);
  }

  const result = DeploymentSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Deployment manifest at ${path} is malformed:\n${issues}`);
  }
  return result.data;
}
