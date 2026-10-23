import { useState } from 'react';
import { ApprovalCard, type ApprovalCardAnswers } from '../../beui/registry/components/agents/approval-card';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import type { Language } from '../AgentsConfig';

type NativeQuestion = {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: { label: string; description?: string; preview?: string }[];
};

function parseQuestions(input: unknown): NativeQuestion[] {
    if (!input || typeof input !== 'object' || !('questions' in input) || !Array.isArray(input.questions)) return [];
    return input.questions.every(q =>
        q && typeof q.question === 'string' && q.question.trim() &&
        Array.isArray(q.options) && q.options.every((option: NativeQuestion['options'][number]) =>
            option && typeof option.label === 'string' &&
            (option.description === undefined || typeof option.description === 'string') &&
            (option.preview === undefined || typeof option.preview === 'string')))
        ? input.questions : [];
}

export function UserQuestionPanel({ input, lang, busy, error, onSubmit, onDismiss }: {
    input: unknown;
    lang: Language;
    busy: boolean;
    error?: string;
    onSubmit?: (answers: Record<string, string>) => Promise<void>;
    onDismiss?: () => Promise<void>;
}) {
    const text = useBeeGameText(lang).userQuestion;
    const questions = parseQuestions(input);
    const [answers, setAnswers] = useState<ApprovalCardAnswers>({});
    return <div className="mb-3" data-testid="beegame-question-panel">
        {questions.length ? <ApprovalCard
            questions={questions.map((question, index) => ({
                id: String(index),
                title: question.question,
                description: question.header,
                options: question.options.map(option => ({
                    value: option.label,
                    label: option.description ? `${option.label} — ${option.description}` : option.label,
                })),
                multiple: question.multiSelect,
                autoAdvance: false,
                allowCustom: true,
                customPlaceholder: text.custom,
            }))}
            answers={answers}
            onAnswersChange={setAnswers}
            status={busy || !onSubmit ? 'submitting' : 'pending'}
            submitLabel={text.submit}
            questionLabels={{
                previous: text.previous, next: text.next, submit: text.submit,
                dismiss: text.dismiss,
                progress: (current, total) => text.progress.replace('{current}', String(current)).replace('{total}', String(total)),
            }}
            onSubmit={values => {
                const valuesByQuestion = Object.fromEntries(questions.map((question, index) => {
                    const answer = values[String(index)];
                    return [question.question, [...(answer?.selected ?? []), ...(answer?.custom?.trim() ? [answer.custom.trim()] : [])].join(', ')];
                }));
                void onSubmit?.(valuesByQuestion);
            }}
            onDismiss={onDismiss ? () => void onDismiss() : undefined}
            className="text-[var(--text-primary)]"
        /> : <div role="alert" className="type-body text-[var(--text-secondary)]">
            {text.invalid}
            {onDismiss && <button type="button" disabled={busy} onClick={() => void onDismiss()} className="ml-2 underline">{text.dismiss}</button>}
        </div>}
        {questions.some(question => question.options.some(option => option.preview)) && <details className="mt-2 type-caption-1">
            <summary>{text.previews}</summary>
            {questions.flatMap((question, index) => question.options.filter(option => option.preview).map(option =>
                <div key={`${index}:${option.label}`} className="mt-2">
                    <p>{question.question} · {option.label}</p>
                    <pre className="whitespace-pre-wrap break-words">{option.preview}</pre>
                </div>))}
        </details>}
        {error && <p role="alert" className="mt-2 type-caption-1 text-red-500">{error}</p>}
    </div>;
}
