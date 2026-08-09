/**
 * Non-authority metadata paths permitted on ae/control.
 * These are not folded into ControlObjects and never authorize task state.
 */
export const CONTROL_METADATA_PATHS = [
  "CONTROL_PLANE.md",
  ".ae-control-bootstrap",
] as const;

export type ControlMetadataPath = (typeof CONTROL_METADATA_PATHS)[number];

export function isControlMetadataPath(path: string): boolean {
  return (CONTROL_METADATA_PATHS as readonly string[]).includes(path);
}

export const BOOTSTRAP_CONTROL_PLANE_MD = `# Agentic Engineering control plane

This branch (\`ae/control\`) holds append-only control-plane objects for Global Content
Agentic Engineering. Application code must not be merged here.

Authority objects use the Phase A path grammar under \`contracts/\`, \`events/\`,
\`proposed/\`, and \`closures/\`.
`;

export const BOOTSTRAP_MARKER = `ae-control-bootstrap:v1
strategy: orphan-commit
`;
