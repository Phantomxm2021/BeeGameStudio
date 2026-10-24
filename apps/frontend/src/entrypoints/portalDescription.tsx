import { createRoot, type Root } from 'react-dom/client';
import { PublicationMarkdown } from '../components/Common/PublicationMarkdown';
import { publicationSections } from '../utils/publicationPresentation';

let root: Root | undefined;
export function renderPublicationDescription(description: string, title: string) {
  root ??= createRoot(document.getElementById('game-description-text')!);
  root.render(<>{publicationSections(description, title).map(section =>
    <section className={`description-card description-${section.kind}`} key={section.kind} aria-labelledby={`description-${section.kind}-title`}>
      <h2 id={`description-${section.kind}-title`}>{section.heading}</h2>
      <div className="description-card-content" tabIndex={0} role="region" aria-labelledby={`description-${section.kind}-title`}>
        <PublicationMarkdown>{section.text}</PublicationMarkdown>
      </div>
    </section>,
  )}</>);
}
