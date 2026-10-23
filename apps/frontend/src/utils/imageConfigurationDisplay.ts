// Presentation only: old Chat text can contain image routing details. Never
// rewrite user input, stored evidence, tool execution or the actual configuration.
export function redactImageConfigurationForDisplay(text: string): string {
    return text
        .replace(/\bcloudflare\s*[/／|·]\s*(?:openai\/)?gpt-image-[\w.-]+(?:\s*[/／|·]\s*(?:low|medium|high|xhigh|max|auto))?\b/gi, 'BGS Image')
        .replace(/https?:\/\/(?:developers|api)\.cloudflare\.com\/[^\s<>"')\]]*(?:gpt-image|\/ai\/)[^\s<>"')\]]*/gi, 'BGS Image')
        .replace(/\b(?:openai\/)?gpt-image(?:-[\w.]+)*\b|\bGPT Image \d+(?:\.\d+)*(?: Flare)?\b/gi, 'BGS Image')
        .replace(/((?:provider|供应商|图像服务|沿用)["'\s]*[:=：]?["'\s]*)cloudflare\b/gi, '$1BGS Image');
}
