// Public landing page, styled after the Riven reference: a centred serif headline,
// a soft pixel band, and dark and white pill buttons.
export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="brand">Bulletproof HSC</span>
        <nav aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#journal">Mistake journal</a>
        </nav>
        <button type="button" className="pill-white" onClick={onSignIn}>Sign in</button>
      </header>

      <main className="landing-hero">
        <span className="eyebrow">Study tracker for HSC students</span>
        <h1>
          Turn study time into <em>club progress.</em>
          <br />
          Learn from every <span className="muted-serif">mistake.</span>
        </h1>
        <p className="lede">
          Log study sessions, earn club cash and fixtures, and keep a mistake journal that brings back the mistakes you
          haven't fixed yet.
        </p>
        <div className="cta">
          <button type="button" className="pill-dark" onClick={onSignIn}>Get started</button>
          <button type="button" className="pill-white" onClick={onSignIn}>Sign in</button>
        </div>
        <div className="pixel-band" aria-hidden="true" />
      </main>

      <section id="features" className="landing-features">
        <article>
          <h3>Study log</h3>
          <p>Log each session by subject and activity. Past papers and exam-style questions earn more.</p>
        </article>
        <article>
          <h3>Your club</h3>
          <p>Club cash and fixtures build up as you study, so the work shows as progress.</p>
        </article>
        <article id="journal">
          <h3>Mistake journal</h3>
          <p>Record each mistake, its correction and category, and review it until it's fixed.</p>
        </article>
      </section>
    </div>
  );
}
