import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import { WaitlistForm } from "./WaitlistForm";

function Lines({ lines, className = "" }: { lines: string[]; className?: string }) {
  return (
    <>
      {lines.map((line, index) => (
        <span className={`semantic-line ${className}`.trim()} key={`${line}-${index}`}>
          {line}
        </span>
      ))}
    </>
  );
}

export function NarrativeSections() {
  const { messages, locale } = useLocale();
  const [activeStage, setActiveStage] = useState(0);
  const [isProcessPaused, setIsProcessPaused] = useState(false);
  const processRef = useRef<HTMLElement>(null);
  const heroLines = locale === "zh-CN"
    ? ["把想法，", "做成游戏。"]
    : locale === "ja"
      ? ["アイデアを、", "ゲームへ。"]
      : locale === "ko"
        ? ["아이디어를,", "게임으로."]
        : ["Your idea.", "A real game."];

  const reduceMotion = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const revealables = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window)) {
      revealables.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.18 });

    revealables.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduceMotion || typeof window === "undefined") return;

    const element = processRef.current;
    if (!element) return;

    let frame = 0;
    const updateStage = () => {
      frame = 0;
      const scrollRange = Math.max(element.offsetHeight - window.innerHeight, 1);
      const progress = Math.min(1, Math.max(0, -element.getBoundingClientRect().top / scrollRange));
      const nextStage = Math.min(messages.moment.stages.length - 1, Math.floor(progress * messages.moment.stages.length));
      setActiveStage((stage) => stage === nextStage ? stage : nextStage);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateStage);
    };

    updateStage();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [messages.moment.stages.length, reduceMotion]);

  const selectStage = (index: number) => {
    setActiveStage(index);
    setIsProcessPaused(true);

    const element = processRef.current;
    if (!element || reduceMotion || element.offsetHeight <= window.innerHeight) return;

    const scrollRange = element.offsetHeight - window.innerHeight;
    const top = window.scrollY + element.getBoundingClientRect().top;
    window.scrollTo({
      behavior: "smooth",
      top: top + scrollRange * (index / messages.moment.stages.length),
    });
  };

  const resumeProcess = () => setIsProcessPaused(false);

  return (
    <main>
      <section className="hero" id="top" aria-labelledby="hero-title">
        <img className="hero-image" src="/images/game/hero-game-native-v1.png" alt={messages.hero.imageAlt} />
        <div className="hero-copy">
          <h1 id="hero-title" className="zh-display"><Lines lines={heroLines} /></h1>
          <p className="hero-sub zh-copy">{messages.hero.body}</p>
          <div className="hero-actions">
            <a className="primary" href="#waitlist">{messages.nav.join}<span aria-hidden="true">→</span></a>
            <a className="quiet-link" href="#story">{messages.hero.continue}&nbsp; ↓</a>
          </div>
        </div>
        <p className="hero-note">{messages.hero.note}</p>
      </section>

      <section className="manifesto section" data-reveal id="story" aria-labelledby="manifesto-title">
        <small data-reveal-item>{messages.manifesto.eyebrow}</small>
        <h2 id="manifesto-title" className="zh-display" data-reveal-item>
          <Lines lines={[messages.manifesto.title, messages.manifesto.muted]} />
        </h2>
        <div className="manifesto-copy zh-copy" data-reveal-item>
          {messages.manifesto.body.map((paragraph) => <p className="copy-paragraph" key={paragraph}>{paragraph}</p>)}
        </div>
      </section>

      <section className="moment process" data-reveal data-scroll-story="true" ref={processRef} aria-labelledby="moment-title">
        <div
          className="process-visual"
          data-process-paused={isProcessPaused ? "true" : "false"}
          data-reveal-item
          onBlurCapture={(event) => {
            const relatedTarget = event.relatedTarget;
            if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) resumeProcess();
          }}
          onFocusCapture={() => setIsProcessPaused(true)}
          onMouseEnter={() => setIsProcessPaused(true)}
          onMouseLeave={resumeProcess}
        >
          <div className="process-topline">
            <span>BEE GAME STUDIO</span>
            <span>{messages.moment.stages[activeStage].label}</span>
          </div>
          <div className="process-canvas" aria-live="polite" aria-atomic="true">
            <div className={`process-frame process-frame--idea ${activeStage === 0 ? "is-active" : ""}`} aria-hidden={activeStage !== 0}>
                <small>01 / {messages.moment.stages[0].label}</small>
                <p>{messages.moment.quote}</p>
                <span className="process-cursor" aria-hidden="true" />
            </div>
            <div className={`process-frame process-frame--rules ${activeStage === 1 ? "is-active" : ""}`} aria-hidden={activeStage !== 1}>
                <small>02 / {messages.moment.stages[1].label}</small>
                <div className="rule-map" aria-hidden="true">
                  <span>{messages.moment.ruleLabels[0]}</span>
                  <i />
                  <span>{messages.moment.ruleLabels[1]}</span>
                  <i />
                  <span>{messages.moment.ruleLabels[2]}</span>
                </div>
                <p>{messages.moment.stages[1].text}</p>
            </div>
            <div className={`process-frame process-frame--build ${activeStage === 2 ? "is-active" : ""}`} aria-hidden={activeStage !== 2}>
                <small>03 / {messages.moment.stages[2].label}</small>
                <div className="scene-build" aria-hidden="true">
                  <i className="scene-build__moon" />
                  <i className="scene-build__rain scene-build__rain--one" />
                  <i className="scene-build__rain scene-build__rain--two" />
                  <i className="scene-build__rain scene-build__rain--three" />
                  <div className="scene-build__store">
                    <i className="scene-build__roof" />
                    <i className="scene-build__window" />
                    <i className="scene-build__door" />
                    <i className="scene-build__light" />
                  </div>
                  <i className="scene-build__person" />
                  <i className="scene-build__choice" />
                </div>
                <p>{messages.moment.stages[2].text}</p>
            </div>
            <div className={`process-frame process-frame--play ${activeStage === 3 ? "is-active" : ""}`} aria-hidden={activeStage !== 3}>
                <img className="process-art" src="/images/game/store-choice-v1.png" alt={messages.moment.imageAlt} />
                <span>{messages.moment.detail}</span>
            </div>
          </div>
          <div className="process-controls" role="tablist" aria-label={messages.moment.eyebrow}>
            {messages.moment.stages.map((stage, index) => (
              <button
                aria-selected={activeStage === index}
                className={activeStage === index ? "is-active" : ""}
                key={stage.label}
                onClick={() => selectStage(index)}
                role="tab"
                type="button"
              >
                <span aria-hidden="true">0{index + 1}</span>
                {stage.label}
              </button>
            ))}
          </div>
        </div>
        <div className="process-story" data-reveal-item>
          <div className="moment-copy">
            <span className="tiny">{messages.moment.eyebrow}</span>
            <h2 id="moment-title" className="zh-display"><Lines lines={messages.moment.conclusion} /></h2>
            <p className="zh-copy">{messages.moment.body}</p>
          </div>
          <div className="process-beats" aria-label={messages.moment.eyebrow}>
            {messages.moment.stages.map((stage, index) => (
              <article className={`process-beat ${activeStage === index ? "is-active" : ""}`} key={stage.label}>
                <small>0{index + 1} / {stage.label}</small>
                <p>{stage.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="change section" data-reveal aria-labelledby="change-title">
        <h2 id="change-title" className="zh-display" data-reveal-item><Lines lines={messages.change.title} /></h2>
        <div className="edits" data-reveal-item>
          {messages.change.edits.map((edit, index) => (
            <div className="edit" key={edit}><span>0{index + 1}</span>{edit}</div>
          ))}
        </div>
        <p className="change-note zh-copy" data-reveal-item>{messages.change.body}</p>
      </section>

      <section className="ownership section" data-reveal aria-labelledby="ownership-title">
        <span className="tiny" data-reveal-item>{messages.ownership.eyebrow}</span>
        <h2 id="ownership-title" className="zh-display" data-reveal-item><Lines lines={messages.ownership.title} /></h2>
        <div className="growth" data-reveal-item>
          {messages.ownership.stages.map((stage, index) => (
            <div key={`${stage.time}-${stage.title}`}>
              <small>{stage.time}</small>
              <h3>{stage.title}</h3>
              <p>{stage.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vision section" data-reveal id="belief" aria-labelledby="vision-title">
        <small data-reveal-item>{messages.vision.eyebrow}</small>
        <h2 id="vision-title" className="zh-display" data-reveal-item>
          <Lines lines={messages.vision.title} />
          <span className="semantic-line"><em>{messages.vision.emphasis}</em></span>
        </h2>
        <div className="vision-copy zh-copy" data-reveal-item>
          {messages.vision.body.map((paragraph) => <p className="copy-paragraph" key={paragraph}>{paragraph}</p>)}
        </div>
      </section>

      <section className="waitlist section" data-reveal id="waitlist" aria-labelledby="waitlist-title">
        <div className="wait-copy" data-reveal-item>
          <h2 id="waitlist-title" className="zh-display"><Lines lines={messages.waitlist.title} /></h2>
          <p className="zh-copy">{messages.waitlist.body}</p>
        </div>
        <WaitlistForm />
        <div className="footer" data-reveal-item>
          <strong>BEE GAME STUDIO</strong>
          <span>{messages.hero.title}</span>
          <span>© 2026</span>
        </div>
      </section>
    </main>
  );
}
