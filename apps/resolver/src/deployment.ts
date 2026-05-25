import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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

function findPath(): string {
  const override = process.env.DEPLOYMENT_PATH;
  if (override) return resolve(process.cwd(), override);
  const candidates = [
    resolve(process.cwd(), "deployments/arc-testnet.json"),
    resolve(process.cwd(), "../../deployments/arc-testnet.json"),
    resolve(process.cwd(), "../deployments/arc-testnet.json"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../deployments/arc-testnet.json"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

export function loadDeployment(): Deployment {
  const path = findPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Cannot read deployment manifest at ${path}. ` +
        `Run \`forge script contracts/script/Deploy.s.sol --rpc-url arc-testnet --broadcast --slow\` or set DEPLOYMENT_PATH.`,
    );
  }
  const json = JSON.parse(raw);
  const parsed = DeploymentSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Deployment manifest malformed: ${parsed.error.message}`);
  }
  return parsed.data;
}
