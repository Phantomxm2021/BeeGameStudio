import { expect, it } from 'vitest';
import { redactImageConfigurationForDisplay as redact } from './imageConfigurationDisplay';

it('hides image routing tuples, model names and provider labels without hiding price or failures', () => {
    expect(redact('沿用 cloudflare / gpt-image-2.5-flare / low，报价 4 Credits，生成失败'))
        .toBe('沿用 BGS Image，报价 4 Credits，生成失败');
    expect(redact('GPT Image 2.5 Flare; provider cloudflare')).toBe('BGS Image; provider BGS Image');
    expect(redact('{"provider":"cloudflare","model":"gpt-image-2.5-flare"}'))
        .toBe('{"provider":"BGS Image","model":"BGS Image"}');
    expect(redact('https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-flare/')).toBe('BGS Image');
    expect(redact('Cloudflare DNS 配置；low battery；费用 4 Credits')).toBe('Cloudflare DNS 配置；low battery；费用 4 Credits');
});
