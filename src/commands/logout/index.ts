import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  getAPIProvider,
  isThirdPartyAPIProvider,
} from '../../utils/model/providers.js'

export default {
  type: 'local-jsx',
  name: 'logout',
  description: 'Sign out from your configured account',
  isEnabled: () =>
    !isThirdPartyAPIProvider(getAPIProvider()) &&
    !isEnvTruthy(process.env.DISABLE_LOGOUT_COMMAND),
  load: () => import('./logout.js'),
} satisfies Command
