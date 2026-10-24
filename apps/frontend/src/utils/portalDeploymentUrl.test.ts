import { describe, expect, it } from 'vitest';
import { portalDeploymentUrl, portalProjectUrl } from './portalDeploymentUrl';

describe('portalDeploymentUrl', () => {
  it('preserves the exact published version on the portal domain', () => {
    expect(portalDeploymentUrl('https://portal.beegame.studio', 'https://game.beegame.studio/deployments/deploy_1/files/index.html'))
      .toBe('https://portal.beegame.studio/deployments/deploy_1/files/index.html');
  });
  it('keeps the game URL when the portal is not configured', () => {
    expect(portalDeploymentUrl(undefined, 'https://game.beegame.studio/deployments/deploy_1/files/index.html'))
      .toBe('https://game.beegame.studio/deployments/deploy_1/files/index.html');
  });
  it('does not rewrite unrelated links', () => {
    expect(portalDeploymentUrl('https://portal.beegame.studio', 'https://game.beegame.studio/other'))
      .toBe('https://game.beegame.studio/other');
  });
  it('gives a project one stable public link regardless of deployment version', () => {
    const base = 'https://portal.beegame.studio';
    const first = portalProjectUrl(base, 'project_1', 'https://game.beegame.studio/deployments/first/files/index.html');
    const second = portalProjectUrl(base, 'project_1', 'https://game.beegame.studio/deployments/second/files/index.html');
    expect(first).toBe('https://portal.beegame.studio/g/project_1');
    expect(second).toBe(first);
  });
  it('opens the rollback release record even when it reuses a pre-Portal file URL', () => {
    expect(portalDeploymentUrl('https://portal.example.test', 'https://game.example.test/deployments/legacy/files/index.html', 'rollback_2'))
      .toBe('https://portal.example.test/deployments/rollback_2/files/index.html');
  });

});
