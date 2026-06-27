import type { ReviewStatusPayload } from '../services/api';
import type { ReviewStatusDisplayPayload } from '../viewModels/displayModels';

const ZH_CN_MESSAGES: Record<string, string> = {
  'review.awaiting_user': '当前 review 已通过，正在等待用户确认，暂不支持发送普通消息。',
  'review.revision_required': '当前内容需要先修订，暂不支持发送普通消息。',
  'review.running': '当前 review 正在执行，请稍候。',
  'review.escalated': '当前 review 需要人工介入，请先处理评审问题。',
  'review.approved': '当前文档已通过 review。',
  'review.self.running': '当前正在执行自检，请稍候。',
  'review.self.approved': '自检已通过。',
  'review.self.revision_required': '自检发现需要修订的问题。',
  'review.self.escalated': '自检需要人工介入。',
  'review.board.running': '当前 internal review 正在执行，请稍候。',
  'review.board.awaiting_user': '当前 review 已完成，正在等待用户确认，暂不支持发送普通消息。',
  'review.board.revision_required': '当前内容需要先修订，暂不支持发送普通消息。',
  'review.board.escalated': '当前 internal review 需要人工介入，请先处理评审问题。',
  'review.user_approved': '用户已审批通过当前文档。',
  'review.user_revision_requested': '用户要求修订当前文档。',
  'review.user_rejected': '用户拒绝了当前文档。',
};

const EN_US_MESSAGES: Record<string, string> = {
  'review.awaiting_user': 'Internal review passed and is waiting for user approval.',
  'review.revision_required': 'The current content must be revised before normal chat can continue.',
  'review.running': 'Review is still running.',
  'review.escalated': 'Review needs manual intervention.',
  'review.approved': 'The current document passed review.',
  'review.self.running': 'Self review is running.',
  'review.self.approved': 'Self review passed.',
  'review.self.revision_required': 'Self review found issues that require revision.',
  'review.self.escalated': 'Self review needs manual intervention.',
  'review.board.running': 'Internal board review is running.',
  'review.board.awaiting_user': 'Internal review completed and is waiting for user approval.',
  'review.board.revision_required': 'The current content must be revised before normal chat can continue.',
  'review.board.escalated': 'Internal board review needs manual intervention.',
  'review.user_approved': 'User approved the current document.',
  'review.user_revision_requested': 'User requested revisions for the current document.',
  'review.user_rejected': 'User rejected the current document.',
};

const getLocaleMessages = (locale?: string): Record<string, string> => {
  const normalized = String(locale ?? '').toLowerCase();
  return normalized.startsWith('zh') ? ZH_CN_MESSAGES : EN_US_MESSAGES;
};

export const getPreferredLocale = (): string => {
  if (typeof navigator === 'undefined') {
    return 'en-US';
  }
  return String(navigator.language || 'en-US');
};

export const localizeReviewMessage = (
  reviewStatus?: ReviewStatusPayload | ReviewStatusDisplayPayload | null,
  locale: string = getPreferredLocale(),
): string => {
  const key = String(reviewStatus?.message?.message_key ?? '').trim();
  if (!key) return '';
  return getLocaleMessages(locale)[key] ?? key;
};

export const localizeReviewStage = (
  reviewStatus?: ReviewStatusPayload | ReviewStatusDisplayPayload | null,
  locale: string = getPreferredLocale(),
): string => {
  return localizeReviewMessage(reviewStatus, locale);
};
