import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const e2eDir = fileURLToPath(new URL("..", import.meta.url));

export const docker = (args) => execSync(`docker ${args}`, { stdio: "pipe" }).toString();
export const compose = (args) => docker(`compose -f ${e2eDir}/compose.yaml ${args}`);
