import { useTranslation } from 'react-i18next';
import { createRoot, type Root } from 'react-dom/client';
import { PublicationMarkdown } from '../components/Common/PublicationMarkdown';
import { publicationSections } from '../utils/publicationPresentation';
import { portalControlComponents } from './portalControls';

let root: Root | undefined;
export function renderPublicationDescription(description: string, title: string) {
  root ??= createRoot(document.getElementById('game-description-text')!);
  root.render(<PortalDescription description={description} title={title} />);
}
export function PortalDescription({ description, title }: { description: string; title: string }) {
  const { t } = useTranslation('portal');
  const sections = publicationSections(description, title);
  const order = { introduction: 0, gameplay: 1, controls: 2 };
  return <>{sections.sort((a, b) => order[a.kind] - order[b.kind]).map(section =>
    <section className={`description-card description-${section.kind}`} key={section.kind} aria-labelledby={`description-${section.kind}-title`}>
      <h2 id={`description-${section.kind}-title`}>{t(section.kind === 'introduction' ? 'introduction' : section.kind === 'gameplay' ? 'gameplay' : 'controls')}</h2>
      <div className="description-card-content" tabIndex={0} role="region" aria-labelledby={`description-${section.kind}-title`}>
        <PublicationMarkdown components={section.kind === 'controls' ? portalControlComponents : undefined}>{section.text}</PublicationMarkdown>
      </div>
    </section>,
  )}</>;
}
