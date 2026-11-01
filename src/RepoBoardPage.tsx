// Repo Board is its own Worker (swamp2k/repo-board) behind Cloudflare Access.
// Nexus only shows it in a frame; sign-in and data stay in that Worker.
const REPO_BOARD_URL = "https://repo-board.sr-goodjob.workers.dev/";

export default function RepoBoardPage() {
  return (
    <section className="repo-board">
      <p className="repo-board-note">
        Hvis tavlen ikke vises, så log ind først: <a href={REPO_BOARD_URL} target="_blank" rel="noreferrer">åbn Repo Board i nyt vindue</a>.
      </p>
      <iframe className="repo-board-frame" src={REPO_BOARD_URL} title="Repo Board" />
    </section>
  );
}
