import { createRoot, type Root } from 'react-dom/client';
import { PublicationMarkdown } from '../components/Common/PublicationMarkdown';

let root: Root | undefined;
export function renderPublicationDescription(description: string) {
  root ??= createRoot(document.getElementById('game-description-text')!);
  root.render(<PublicationMarkdown>{description}</PublicationMarkdown>);
}
