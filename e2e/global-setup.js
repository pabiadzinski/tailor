import { compose } from "./tests/docker.js";

export default function () {
  compose("up -d --force-recreate --wait");
  return () => compose("down -t 0");
}
