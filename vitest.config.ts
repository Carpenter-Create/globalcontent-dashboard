import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // src/lib/s3.ts validates these at module load now — a hard failure on an unset bucket/
    // region is the whole point (fix round 1, item 2: an unset S3_BUCKET must never silently
    // become `Bucket: undefined` and get misread as "object absent"). Any test that imports
    // the real (unmocked) module — even just for a pure export like parseRestore — needs these
    // set or the import itself throws. Dummy values only; every test that exercises actual AWS
    // calls mocks the SDK client directly.
    env: {
      AWS_REGION: "us-east-1",
      S3_BUCKET: "test-bucket",
      S3_AVATARS_BUCKET: "test-avatars-bucket",
    },
  },
});
