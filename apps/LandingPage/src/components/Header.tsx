import { LanguageSelector } from "./LanguageSelector";
import { useLocale } from "../i18n/LocaleProvider";

export function Header() {
  const { messages } = useLocale();

  return (
    <nav className="nav" aria-label={messages.nav.primary}>
      <a className="brand" href="#top" aria-label="Bee Game Studio">
        <img src="/assets/bgs_logo.svg" alt="" />
        <span>BEE GAME STUDIO</span>
      </a>
      <div className="nav-right">
        <a href="#story">{messages.nav.story}</a>
        <a href="#belief">{messages.nav.belief}</a>
        <LanguageSelector />
        <a className="nav-join" href="#waitlist">{messages.nav.join}</a>
      </div>
    </nav>
  );
}
