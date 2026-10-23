import type { ChatDisplayMessage } from '../../viewModels/displayModels';
import { toChatDisplayMessages } from '../../viewModels/displayModels';
import { normalizeChatHistory } from '../../utils/chatHistory';
import { transcriptEventsToHistory } from '../../services/beeGameAdapter';
import canonicalTranscriptEvents from './canonicalTranscriptEvents.json';

const PROJECT_ID = 'night-courtyard-crystal-shockwave';

/** Canonical runtime transcript used by feed regression tests only. */
export const sampleMessages: ChatDisplayMessage[] = toChatDisplayMessages(normalizeChatHistory(
  transcriptEventsToHistory(PROJECT_ID, canonicalTranscriptEvents),
));
