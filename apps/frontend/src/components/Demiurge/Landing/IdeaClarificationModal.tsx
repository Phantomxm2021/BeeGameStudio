import { ArrowLeft, ArrowRight, Edit3, Loader2, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { Language } from '../AgentsConfig';
import type { ClarificationSuggestionPayload, IdeaIntakeAnalysisPayload } from '../../../services/api';

interface IdeaClarificationModalProps {
    analysis: IdeaIntakeAnalysisPayload;
    isSubmitting: boolean;
    lang: Language;
    onSelect: (patch: Record<string, string>) => void;
    onManual: () => void;
}

type Option = {
    label: string;
    value: string;
    inputMode?: string;
    directiveType?: string;
};

type OptionGroup = {
    key: 'platform' | 'visual_style' | 'game_mode' | 'rendering_mode' | 'mvp_scope';
    title: string;
    options: Option[];
};

const copy: Partial<Record<Language, {
    title: string;
    helper: string;
    templateStep: string;
    choicesStep: string;
    select: string;
    back: string;
    submit: string;
    manual: string;
}>> = {
    zh: {
        title: '补齐第一版方向',
        helper: '先选玩法模板，再补齐少量制作选项；不确定时选最接近的即可。',
        templateStep: '选择玩法模板',
        choicesStep: '补齐制作选项',
        select: '使用这个模板',
        back: '返回模板',
        submit: '开始创建',
        manual: '自己填写',
    },
    'zh-TW': {
        title: '補齊第一版方向',
        helper: '先選玩法模板，再補齊少量製作選項；不確定時選最接近的即可。',
        templateStep: '選擇玩法模板',
        choicesStep: '補齊製作選項',
        select: '使用這個模板',
        back: '返回模板',
        submit: '開始建立',
        manual: '自己填寫',
    },
    en: {
        title: 'Shape the first version',
        helper: 'Pick a gameplay template, then choose a few production constraints.',
        templateStep: 'Choose gameplay template',
        choicesStep: 'Choose production options',
        select: 'Use this template',
        back: 'Back to templates',
        submit: 'Start build',
        manual: 'Write my own',
    },
    ja: {
        title: '最初の方向を整える',
        helper: 'テンプレートを選び、制作条件を少しだけ補足します。',
        templateStep: 'ゲームプレイテンプレート',
        choicesStep: '制作オプション',
        select: 'このテンプレートを使う',
        back: 'テンプレートに戻る',
        submit: '作成を開始',
        manual: '自分で入力',
    },
    ko: {
        title: '첫 버전 방향 정하기',
        helper: '게임플레이 템플릿을 고른 뒤 제작 선택지를 간단히 채웁니다.',
        templateStep: '게임플레이 템플릿 선택',
        choicesStep: '제작 옵션 선택',
        select: '이 템플릿 사용',
        back: '템플릿으로 돌아가기',
        submit: '생성 시작',
        manual: '직접 입력',
    },
};

const baseOptionGroups: OptionGroup[] = [
    {
        key: 'platform',
        title: '引擎',
        options: [
            { label: 'Web React', value: 'Web React' },
            { label: 'Unity', value: 'Unity' },
        ],
    },
    {
        key: 'visual_style',
        title: '游戏风格',
        options: [
            { label: '由AI决定', value: 'delegated', directiveType: 'delegated' },
            { label: '清爽卡通', value: '清爽卡通' },
            { label: '低多边形', value: '低多边形' },
            { label: '像素风', value: '像素风' },
            { label: '写实风格', value: '写实风格' },
            { label: '赛博霓虹', value: '赛博霓虹' },
        ],
    },
    {
        key: 'game_mode',
        title: '游戏模式',
        options: [
            { label: '单机', value: '单机' },
            { label: '多人', value: '多人' },
            { label: '可先单机后扩展多人', value: '可先单机后扩展多人' },
        ],
    },
    {
        key: 'rendering_mode',
        title: '表现形式',
        options: [
            { label: '2D', value: '2D' },
            { label: '3D', value: '3D' },
            { label: '2.5D / 等距', value: '2.5D / 等距' },
        ],
    },
    {
        key: 'mvp_scope',
        title: 'MVP 范围',
        options: [
            { label: '极简核心循环', value: '极简核心循环' },
            { label: '可玩关卡/单局', value: '可玩关卡/单局' },
            { label: '带基础成长或排行榜', value: '带基础成长或排行榜' },
        ],
    },
];

const fullWidthOptionKeys = new Set<OptionGroup['key']>(['mvp_scope']);

const optionGroupsFor = (suggestion: ClarificationSuggestionPayload | null): OptionGroup[] => {
    const visualStyles = suggestion?.metadata?.visual_styles?.filter(Boolean).slice(0, 3) || [];
    if (visualStyles.length === 0) {
        return baseOptionGroups;
    }
    return baseOptionGroups.map((group) => {
        if (group.key !== 'visual_style') return group;
        const values = new Set<string>();
        const options = [
            { label: '由AI决定', value: 'delegated', directiveType: 'delegated' },
            ...visualStyles.map((style) => ({ label: style, value: style })),
            ...group.options.slice(1),
        ].filter((option) => {
            if (values.has(option.value)) return false;
            values.add(option.value);
            return true;
        });
        return { ...group, options };
    });
};

const firstQuestion = (analysis: IdeaIntakeAnalysisPayload): string => (
    analysis.clarification_questions[0] || 'Logos needs one more decision before starting Phase 0.'
);

const clampStyle = (lines: number): CSSProperties => ({
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
});

export function IdeaClarificationModal({
    analysis,
    isSubmitting,
    lang,
    onSelect,
    onManual,
}: IdeaClarificationModalProps) {
    const suggestions = analysis.clarification_suggestions || [];
    const text = copy[lang] || copy.en!;
    const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
    const [draftPatch, setDraftPatch] = useState<Record<string, string>>(() => (
        Object.fromEntries(baseOptionGroups.map((group) => [group.key, group.options[0]?.value || '']))
    ));
    const [inputModes, setInputModes] = useState<Set<string>>(new Set(['键鼠']));
    const selectedSuggestion = suggestions.find((suggestion) => suggestion.id === selectedSuggestionId) || null;
    const optionGroups = optionGroupsFor(selectedSuggestion);
    const selectedVisualOption = optionGroups
        .find((group) => group.key === 'visual_style')
        ?.options.find((option) => option.value === draftPatch.visual_style);

    const selectOption = (group: OptionGroup, option: Option) => {
        setDraftPatch((current) => ({
            ...current,
            [group.key]: option.value,
        }));
    };

    const selectOptionValue = (group: OptionGroup, value: string) => {
        const option = group.options.find((item) => item.value === value);
        if (option) {
            selectOption(group, option);
        }
    };

    const submitSelection = () => {
        if (!selectedSuggestion) return;
        const templateFocus = selectedSuggestion.clarification_patch.mvp_focus || '';
        const focusParts = [
            templateFocus,
            draftPatch.game_mode,
            draftPatch.rendering_mode,
            draftPatch.mvp_scope,
        ].filter(Boolean);
        const patch: Record<string, string> = {
            ...selectedSuggestion.clarification_patch,
            platform: draftPatch.platform,
            input_mode: Array.from(inputModes).join('/'),
            visual_style: draftPatch.visual_style,
            game_mode: draftPatch.game_mode,
            rendering_mode: draftPatch.rendering_mode,
            mvp_scope: draftPatch.mvp_scope,
            mvp_focus: focusParts.join('；'),
        };
        if (selectedVisualOption?.directiveType) {
            patch.visual_style_directive_type = selectedVisualOption.directiveType;
        }
        onSelect(patch);
    };

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="idea-clarification-title"
        >
            <div
                data-testid="idea-clarification-surface"
                data-surface="frosted-glass"
                data-style-source="pixelfork"
                data-glass-density="reinforced"
                className="input-surface relative flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] px-1 py-1 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
            >
                <div className="relative z-10 shrink-0 rounded-[24px] px-5 py-5 sm:px-6">
                    <div className="flex items-center gap-3">
                        {selectedSuggestion && (
                            <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => setSelectedSuggestionId(null)}
                                className="inline-flex items-center justify-center rounded-full bg-[#757575]/10 p-2 text-[#c5c1b9] transition hover:bg-[#757575]/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={text.back}
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>
                        )}
                        <h2 id="idea-clarification-title" className="text-xl font-semibold tracking-normal text-white sm:text-2xl">
                            {text.title}
                        </h2>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#c5c1b9]" style={clampStyle(2)}>
                        {firstQuestion(analysis)}
                    </p>
                </div>

                <div
                    data-testid="idea-clarification-scroll"
                    className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-5 pr-3 [scrollbar-gutter:stable] sm:px-6 sm:pr-4"
                >
                    {!selectedSuggestion ? (
                        <>
                            <div className="pb-3">
                                <h3 className="text-sm font-semibold text-white">{text.templateStep}</h3>
                            </div>
                            <div className="grid gap-3 md:grid-cols-3">
                                {suggestions.map((suggestion: ClarificationSuggestionPayload) => (
                                    <article
                                        key={suggestion.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedSuggestionId(suggestion.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedSuggestionId(suggestion.id);
                                            }
                                        }}
                                        className="flex min-h-[190px] cursor-pointer flex-col justify-between rounded-2xl border border-white/12 bg-[#757575]/10 p-4 text-left transition hover:bg-[#757575]/15"
                                    >
                                        <span>
                                            <span className="block text-base font-semibold leading-6 text-white" style={clampStyle(2)}>
                                                {suggestion.label}
                                            </span>
                                            <span className="mt-2 block text-sm leading-6 text-[#c5c1b9]" style={clampStyle(3)}>
                                                {suggestion.description}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            disabled={isSubmitting}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setSelectedSuggestionId(suggestion.id);
                                            }}
                                            className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-[#757575]/20 px-3 py-2 text-sm font-semibold text-[#ececec] transition hover:bg-[#3f3f3e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {text.select}
                                            <ArrowRight className="h-4 w-4" />
                                        </button>
                                    </article>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div>
                            <div className="mb-4">
                                <h3 className="text-sm font-semibold text-white">{text.choicesStep}</h3>
                            </div>
                            <div
                                data-testid="idea-clarification-option-grid"
                                className="grid gap-x-4 gap-y-3 sm:grid-cols-2"
                            >
                                {optionGroups.map((group) => (
                                    <label
                                        key={group.key}
                                        className={`grid gap-1.5 ${fullWidthOptionKeys.has(group.key) ? 'sm:col-span-2' : ''}`}
                                    >
                                        <span className="text-xs font-semibold leading-5 text-[#c5c1b9]">{group.title}</span>
                                        <select
                                            value={draftPatch[group.key] || ''}
                                            disabled={isSubmitting}
                                            onChange={(event) => selectOptionValue(group, event.target.value)}
                                            className="h-11 w-full rounded-xl border border-white/12 bg-zinc-950/70 px-3 text-sm font-semibold text-white outline-none transition focus:border-white/35 focus:ring-2 focus:ring-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {group.options.map((option) => (
                                                <option key={option.value} value={option.value} className="bg-zinc-950 text-white">
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                            </div>
                            <div className="mt-5 grid gap-1.5 sm:col-span-2">
                                <span className="text-xs font-semibold leading-5 text-[#c5c1b9]">操作兼容</span>
                                <div className="flex flex-wrap gap-2">
                                    {['键鼠', '触屏', '手柄'].map((mode) => {
                                        const isSelected = inputModes.has(mode);
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                disabled={isSubmitting}
                                                onClick={() => {
                                                    setInputModes((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(mode)) {
                                                            if (next.size > 1) {
                                                                next.delete(mode);
                                                            }
                                                        } else {
                                                            next.add(mode);
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                className={`h-11 rounded-xl border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                                    isSelected
                                                        ? 'border-white/35 bg-white/10 text-white'
                                                        : 'border-white/12 bg-zinc-950/70 text-[#c5c1b9] hover:border-white/35 hover:text-white'
                                                }`}
                                            >
                                                {mode}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="relative z-10 flex shrink-0 flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
                    <div className="flex flex-col gap-2 sm:flex-row">
                        {!isSubmitting && (
                            <button
                                type="button"
                                onClick={onManual}
                                disabled={isSubmitting}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-4 py-2 text-sm font-semibold text-[#ececec] transition hover:bg-white/15 hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <Edit3 className="h-4 w-4" />
                                {text.manual}
                            </button>
                        )}
                        {selectedSuggestion ? (
                            <button
                                type="button"
                                onClick={submitSelection}
                                disabled={isSubmitting}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-4 py-2 text-sm font-semibold text-[#ececec] transition hover:bg-white/15 hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                {text.submit}
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
