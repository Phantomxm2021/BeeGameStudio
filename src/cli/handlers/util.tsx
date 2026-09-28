/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 * setup-token
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import React from 'react';
import { WelcomeV2 } from '../../components/LogoV2/WelcomeV2.js';
import type { Root } from '@anthropic/ink';
import { Box, Text } from '@anthropic/ink';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { logEvent } from '../../services/analytics/index.js';
import { AppStateProvider } from '../../state/AppState.js';
import { onChangeAppState } from '../../state/onChangeAppState.js';
import { isAnthropicAuthEnabled } from '../../utils/auth.js';

export async function setupTokenHandler(root: Root): Promise<void> {
  logEvent('tengu_setup_token_command', {});

  const showAuthWarning = !isAnthropicAuthEnabled();
  const { ConsoleOAuthFlow } = await import('../../components/ConsoleOAuthFlow.js');
  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider onChangeAppState={onChangeAppState}>
        <KeybindingSetup>
          <Box flexDirection="column" gap={1}>
            <WelcomeV2 />
            {showAuthWarning && (
              <Box flexDirection="column">
                <Text color="warning">
                  Warning: You already have authentication configured via environment variable or API key helper.
                </Text>
                <Text color="warning">
                  The setup-token command will create a new OAuth token which you can use instead.
                </Text>
              </Box>
            )}
            <ConsoleOAuthFlow
              onDone={() => {
                void resolve();
              }}
              mode="setup-token"
              startingMessage="This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required."
            />
          </Box>
        </KeybindingSetup>
      </AppStateProvider>,
    );
  });
  root.unmount();
  process.exit(0);
}
