import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/** Shared by the release editor and public Portal; raw HTML is never executed. */
export function PublicationMarkdown({ children }: { children: string }) {
  return <div className="publication-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml
      allowedElements={['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
        'blockquote', 'pre', 'code', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input']}
      components={{
        a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled readOnly />,
      }}>{children}</ReactMarkdown>
  </div>;
}
