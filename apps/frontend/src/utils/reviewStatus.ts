import type { ReviewStatusPayload } from '../services/api';
import type { ReviewStatusDisplayPayload } from '../viewModels/displayModels';

const ZH_CN_MESSAGES: Record<string, string> = {
  'review.gdd.awaiting_user': '当前 internal review 已通过，正在等待用户审批，暂不支持发送普通消息。',
  'review.gdd.revision_required': '当前需先修订 GDD，暂不支持发送普通消息。',
  'review.gdd.review_running': '当前 review 正在执行，请稍候。',
  'review.gdd.escalated': '当前 review 需要人工介入，请先处理评审问题。',
  'review.gdd.approved': '当前文档已通过 review。',
  'review.gdd.self_review.running': '当前正在执行 GDD 自检，请稍候。',
  'review.gdd.self_review.approved': 'GDD 自检已通过。',
  'review.gdd.self_review.revision_required': 'GDD 自检发现需要修订的问题。',
  'review.gdd.self_review.escalated': 'GDD 自检需要人工介入。',
  'review.gdd.internal_board.running': '当前 internal review 正在执行，请稍候。',
  'review.gdd.internal_board.awaiting_user': '当前 internal review 已完成，正在等待用户审批，暂不支持发送普通消息。',
  'review.gdd.internal_board.revision_required': '当前需先修订 GDD，暂不支持发送普通消息。',
  'review.gdd.internal_board.escalated': '当前 internal review 需要人工介入，请先处理评审问题。',
  'review.gdd.user_approved': '用户已审批通过当前文档。',
  'review.gdd.user_revision_requested': '用户要求修订当前文档。',
  'review.gdd.user_rejected': '用户拒绝了当前文档。',
};

const EN_US_MESSAGES: Record<string, string> = {
  'review.gdd.awaiting_user': 'Internal review passed and is waiting for user approval.',
  'review.gdd.revision_required': 'The current GDD must be revised before normal chat can continue.',
  'review.gdd.review_running': 'Review is still running.',
  'review.gdd.escalated': 'Review needs manual intervention.',
  'review.gdd.approved': 'The current document passed review.',
  'review.gdd.self_review.running': 'GDD self review is running.',
  'review.gdd.self_review.approved': 'GDD self review passed.',
  'review.gdd.self_review.revision_required': 'GDD self review found issues that require revision.',
  'review.gdd.self_review.escalated': 'GDD self review needs manual intervention.',
  'review.gdd.internal_board.running': 'Internal board review is running.',
  'review.gdd.internal_board.awaiting_user': 'Internal review completed and is waiting for user approval.',
  'review.gdd.internal_board.revision_required': 'The current GDD must be revised before normal chat can continue.',
  'review.gdd.internal_board.escalated': 'Internal board review needs manual intervention.',
  'review.gdd.user_approved': 'User approved the current document.',
  'review.gdd.user_revision_requested': 'User requested revisions for the current document.',
  'review.gdd.user_rejected': 'User rejected the current document.',
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
