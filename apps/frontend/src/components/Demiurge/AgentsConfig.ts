export type Language = 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'it' | 'pt';

export const LANGUAGE_OPTIONS: Array<{ code: Language; label: string }> = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '简体中文' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt', label: 'Português' },
];
