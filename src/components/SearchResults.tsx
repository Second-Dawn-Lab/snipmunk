import { thumbUrl, type Capture, type Group, type Session } from "../ipc";
import { useT } from "../i18n";

export interface SearchHit {
  group: Group;
  capture: Capture;
}

/** The results of a search over all groups: a small card each with the group's badge; a click opens the capture in its group. */
export function SearchResults(props: { session: Session; hits: SearchHit[]; activeId: string | null; onOpen: (hit: SearchHit) => void }) {
  const { t } = useT();
  return (
    <ul className="searchhits" aria-label={t("search.scopeAll")}>
      {props.hits.map(({ group, capture }) => (
        <li key={capture.id}>
          <button type="button" className={`searchhit${capture.id === props.activeId ? " is-active" : ""}`} onClick={() => props.onOpen({ group, capture })}>
            <img className="searchhit__thumb" src={thumbUrl(props.session, capture)} alt="" loading="lazy" />
            <span className="searchhit__name">{capture.name}</span>
            <span className={`searchhit__badge${group.color ? ` gc-${group.color}` : ""}`} title={group.name}>
              {group.emoji ? `${group.emoji} ` : ""}
              {group.name}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
