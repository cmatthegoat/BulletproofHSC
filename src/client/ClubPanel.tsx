import { MINUTES_PER_FIXTURE } from "../shared/rewards";

export interface ClubSummary {
  total_minutes: number;
  club_cash: number;
  fixtures_unlocked: number;
  minutes_to_next_fixture: number;
}

// Study FC's club view: club cash, fixtures unlocked and progress to the next fixture.
export function ClubPanel({ club }: { club: ClubSummary }) {
  const progress = ((MINUTES_PER_FIXTURE - club.minutes_to_next_fixture) / MINUTES_PER_FIXTURE) * 100;
  return (
    <section className="club" aria-labelledby="club-heading">
      <h2 id="club-heading">Your club</h2>
      <div className="club-stats">
        <div className="stat">
          <span className="muted">Club cash</span>
          <strong>{club.club_cash.toFixed(0)}</strong>
        </div>
        <div className="stat">
          <span className="muted">Fixtures unlocked</span>
          <strong>{club.fixtures_unlocked}</strong>
        </div>
        <div className="stat">
          <span className="muted">Study time</span>
          <strong>{Math.floor(club.total_minutes / 60)}h {club.total_minutes % 60}m</strong>
        </div>
      </div>
      <div className="readiness" role="progressbar" aria-label="Progress to next fixture" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="muted">{club.minutes_to_next_fixture} minutes to your next fixture.</p>
    </section>
  );
}
