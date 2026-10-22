import type { LocalSqlResult } from "@/lib/browser-sql";

export type SqlResult = LocalSqlResult;

export default function SqlResults({ results }: { results: SqlResult[] }) {
  return (
    <div className="space-y-4">
      {results.map((r, i) => (
        <div key={i}>
          {r.columns.length > 0 ? (
            <>
              <table className="border-collapse text-left">
                <thead>
                  <tr>{r.columns.map((c, j) => <th key={j} className="border border-zinc-700 bg-zinc-800 px-2 py-1">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {r.rows.map((row, k) => (
                    <tr key={k}>
                      {row.map((v, j) => (
                        <td key={j} className="border border-zinc-800 px-2 py-1">{v === null ? <i className="text-zinc-500">NULL</i> : String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-zinc-500">{r.rows.length} row(s){r.truncated ? " (truncated to 500)" : ""}</p>
            </>
          ) : (
            <p className="text-emerald-400">{r.info ?? (r.affectedRows !== undefined ? `OK, ${r.affectedRows} row(s) affected.` : "OK")}</p>
          )}
        </div>
      ))}
    </div>
  );
}
