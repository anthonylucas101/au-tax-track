import { useRef, useState } from 'react';
import { api, type ImportPreview, type CommitResult } from '../../lib/api.js';

type Phase = 'idle' | 'previewing' | 'previewed' | 'committing' | 'done' | 'error';

export function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    setFiles(chosen);
    setPreview(null);
    setCommitResult(null);
    setPhase(chosen.length > 0 ? 'idle' : 'idle');
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.xlsx'));
    if (dropped.length === 0) return;
    setFiles(dropped);
    setPreview(null);
    setCommitResult(null);
    setPhase('idle');
  }

  async function handlePreview() {
    if (files.length === 0) return;
    setPhase('previewing');
    setErrorMsg(null);
    try {
      const result = await api.importPreview(files);
      setPreview(result);
      setPhase('previewed');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Preview failed');
      setPhase('error');
    }
  }

  async function handleCommit() {
    if (files.length === 0 || !preview) return;
    setPhase('committing');
    setErrorMsg(null);
    try {
      const result = await api.importCommit(files);
      setCommitResult(result);
      setPhase('done');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Import failed');
      setPhase('error');
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const hasErrors = (preview?.errors.length ?? 0) > 0;

  return (
    <div>
      <h2>Import Stake Data</h2>
      <p style={{ maxWidth: 600 }}>
        Download your <strong>INVESTMENT_ACTIVITY</strong>, <strong>INVESTMENT_INCOME</strong>, and{' '}
        <strong>CASH_TRANSACTION</strong> reports from Stake (Reports → Account &amp; Tax Reports),
        then drop them here. You can import one at a time or all three together.
        Files are processed by the local server on your machine and never sent to any external service.
      </p>

      <div
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {files.length === 0
          ? 'Drop .xlsx files here or click to browse'
          : files.map((f) => f.name).join(', ')}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', alignItems: 'center' }}>
        <button onClick={handlePreview} disabled={files.length === 0 || phase === 'previewing' || phase === 'committing'}>
          {phase === 'previewing' ? 'Previewing...' : 'Preview'}
        </button>
        {preview && (
          <button onClick={handleCommit} disabled={phase === 'committing'}>
            {phase === 'committing' ? 'Importing...' : 'Confirm Import'}
          </button>
        )}
      </div>

      {(phase === 'error') && errorMsg && (
        <div className="error" style={{ marginTop: '0.75rem' }}>{errorMsg}</div>
      )}

      {phase === 'done' && commitResult && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#e8f5ee', border: '1px solid #a3d4b5', borderRadius: 4 }}>
          Imported {commitResult.result.inserted.trades} trades,{' '}
          {commitResult.result.inserted.dividends} dividends,{' '}
          {commitResult.result.inserted.cashTransactions} cash transactions.{' '}
          {(commitResult.result.skippedDuplicates.trades + commitResult.result.skippedDuplicates.dividends + commitResult.result.skippedDuplicates.cashTransactions)} duplicates skipped.
        </div>
      )}

      {preview && (
        <div style={{ marginTop: '1.25rem' }}>
          {hasErrors && (
            <div className="error" style={{ marginBottom: '0.75rem' }}>
              <strong>Parse errors detected</strong> — valid rows can still be imported; errors will be skipped.
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.25rem' }}>
                {preview.errors.map((e, i) => (
                  <li key={i}>{e.file} / {e.sheet} row {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.files.map((f) => (
            <div key={f.filename} className="section">
              <h3 style={{ marginBottom: '0.25rem' }}>{f.filename}</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>Kind: {f.kind}</p>
              <table>
                <thead>
                  <tr>
                    <th>Sheet</th>
                    <th className="num">Total</th>
                    <th className="num">New</th>
                    <th className="num">Duplicate</th>
                                      </tr>
                </thead>
                <tbody>
                  {f.sheetSummaries.map((s) => {
                    const key = `${f.filename}::${s.sheet}`;
                    return (
                      <>
                        <tr key={key}>
                          <td>{s.sheet}</td>
                          <td className="num">{s.total}</td>
                          <td className="num"><span className="badge-new">{s.newRows}</span></td>
                          <td className="num"><span className="badge-dup">{s.duplicate}</span></td>                        </tr>
                        <tr key={`${key}-expand`}>
                          <td colSpan={5} style={{ padding: '0 0.55rem 0.4rem' }}>
                            <button
                              className="secondary"
                              style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
                              onClick={() => toggleExpand(key)}
                            >
                              {expanded[key] ? 'Hide rows' : 'Show rows'}
                            </button>
                          </td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>

              {f.sheetSummaries.map((s) => {
                const key = `${f.filename}::${s.sheet}`;
                if (!expanded[key]) return null;
                const sheet = s.sheet.toLowerCase();
                const isTrades = sheet.includes('activit');
                const isDivs = sheet.includes('income') || sheet.includes('dividend');
                return (
                  <div key={`${key}-rows`} style={{ marginBottom: '0.75rem' }}>
                    <strong style={{ fontSize: '0.85rem' }}>{s.sheet} — first 10 rows</strong>
                    {isTrades && (
                      <table style={{ fontSize: '0.82rem' }}>
                        <thead><tr><th>Date</th><th>Ticker</th><th>Side</th><th className="num">Units</th><th className="num">Price</th><th>Currency</th><th>Dup?</th></tr></thead>
                        <tbody>
                          {preview.preview.trades
                            .filter((t) => t.source_file === f.filename && t.source_sheet === s.sheet)
                            .slice(0, 10)
                            .map((t, i) => (
                              <tr key={i}>
                                <td>{t.trade_date}</td>
                                <td>{t.ticker}</td>
                                <td>{t.side}</td>
                                <td className="num">{t.units}</td>
                                <td className="num">{t.price_cents}</td>
                                <td>{t.currency}</td>
                                <td>{t.duplicate ? <span className="badge-dup">dup</span> : <span className="badge-new">new</span>}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                    {isDivs && (
                      <table style={{ fontSize: '0.82rem' }}>
                        <thead><tr><th>Payment Date</th><th>Ticker</th><th>Type</th><th className="num">Total</th><th>Currency</th><th>Dup?</th></tr></thead>
                        <tbody>
                          {preview.preview.dividends
                            .filter((d) => d.source_file === f.filename && d.source_sheet === s.sheet)
                            .slice(0, 10)
                            .map((d, i) => (
                              <tr key={i}>
                                <td>{d.payment_date}</td>
                                <td>{d.ticker}</td>
                                <td>{d.dividend_type ?? '—'}</td>
                                <td className="num">{d.unfranked_cents + d.franked_cents}</td>
                                <td>{d.currency}</td>
                                <td>{d.duplicate ? <span className="badge-dup">dup</span> : <span className="badge-new">new</span>}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                    {!isTrades && !isDivs && (
                      <table style={{ fontSize: '0.82rem' }}>
                        <thead><tr><th>Date</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th>Currency</th><th>Dup?</th></tr></thead>
                        <tbody>
                          {preview.preview.cashTransactions
                            .filter((c) => c.source_file === f.filename && c.source_sheet === s.sheet)
                            .slice(0, 10)
                            .map((c, i) => (
                              <tr key={i}>
                                <td>{c.tx_date}</td>
                                <td>{c.description}</td>
                                <td className="num">{c.debit_cents}</td>
                                <td className="num">{c.credit_cents}</td>
                                <td>{c.currency}</td>
                                <td>{c.duplicate ? <span className="badge-dup">dup</span> : <span className="badge-new">new</span>}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <section className="section">
            <h3>Preview totals</h3>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Trades: {preview.preview.trades.length} rows
              ({preview.preview.trades.filter((t) => t.duplicate).length} dup),{' '}
              Dividends: {preview.preview.dividends.length} rows
              ({preview.preview.dividends.filter((d) => d.duplicate).length} dup),{' '}
              Cash: {preview.preview.cashTransactions.length} rows
              ({preview.preview.cashTransactions.filter((c) => c.duplicate).length} dup).
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

