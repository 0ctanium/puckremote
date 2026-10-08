import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { decisionSource } from '@/lib/source';

type Decision = {
  title: string;
  adr: string;
  provenance: string;
  status: string;
  supersedes?: string[];
  superseded_by?: string;
};
type Adr = { file: string; title: string; status: string };

/** Server component: renders every decision from the index, grouped by ADR. */
export function DecisionIndex() {
  const index = parse(
    readFileSync(path.join(process.cwd(), '../../.claude/adr-index.toml'), 'utf8'),
  ) as { adrs: Record<string, Adr>; decisions: Record<string, Decision> };
  const byAdr = new Map<string, [string, Decision][]>();
  for (const [id, d] of Object.entries(index.decisions)) {
    byAdr.set(d.adr, [...(byAdr.get(d.adr) ?? []), [id, d]]);
  }
  const urlOf = (file: string) => {
    const slug = file.replace(/^\.claude\//, '').replace(/\.md$/, '').split('/');
    return decisionSource.getPage(slug)?.url;
  };
  return (
    <>
      <p>
        Provenance: <code>user</code> (stated by the owner), <code>user-approved-plan</code>{' '}
        (proposed by an agent, approved through a plan), <code>agent-unreviewed</code> (made
        without explicit approval; status <code>needs-review</code> until a human confirms it).
        See the <a href="/decisions/ADR-SYSTEM-GUIDE">ADR system guide</a>.
      </p>
      {Object.entries(index.adrs).map(([name, adr]) => {
        const url = urlOf(adr.file);
        return (
          <section key={name}>
            <h2>{url ? <a href={url}>{adr.title}</a> : adr.title}</h2>
            <p>
              <code>{name}</code> · {adr.status}
            </p>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Decision</th>
                  <th>Provenance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(byAdr.get(name) ?? []).map(([id, d]) => (
                  <tr key={id} id={id}>
                    <td>{id}</td>
                    <td>
                      {d.title}
                      {d.supersedes?.length ? ` (supersedes ${d.supersedes.join(', ')})` : ''}
                      {d.superseded_by ? ` (superseded by ${d.superseded_by})` : ''}
                    </td>
                    <td>{d.provenance}</td>
                    <td>{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
