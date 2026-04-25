// Deployment mode detection
// Controls whether the app runs in single-tenant (standalone) or multi-tenant (hosted) mode

export type DeploymentMode = 'standalone' | 'hosted';

export function getDeploymentMode(): DeploymentMode {
  const mode = process.env.DEPLOYMENT_MODE?.toLowerCase();
  if (mode === 'hosted') return 'hosted';
  return 'standalone';
}

export function isHostedMode(): boolean {
  return getDeploymentMode() === 'hosted';
}

export function isStandaloneMode(): boolean {
  return getDeploymentMode() === 'standalone';
}
