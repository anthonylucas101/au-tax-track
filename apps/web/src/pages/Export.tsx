import { useState } from 'react';
import { useFy } from '../lib/fyContext.js';

const API_BASE = 'http://localhost:3000';

function ExportCard({
  title,
  description,
  buttonLabel,
  url,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  url: string;
}) {
  const [busy, setBusy] = useState(false);

  function handleClick() {
    setBusy(true);
    window.open(url, '_blank');
    // Re-enable after 2s — Content-Disposition:attachment causes download not navigation
    setTimeout(() => setBusy(false), 2000);
  }

  return (
    <div className="card export-card">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      <button className="btn-primary" onClick={handleClick} disabled={busy}>
        {busy ? 'Opening…' : buttonLabel}
      </button>
    </div>
  );
}

export function ExportPage() {
  const { selected, loading } = useFy();

  if (loading || !selected) {
    return (
      <div>
        <h2>Export</h2>
        <p className="muted">Loading financial year…</p>
      </div>
    );
  }

  const fyId = selected.id;
  const accountantUrl = `${API_BASE}/api/export/accountant?fyId=${fyId}`;
  const mytaxUrl = `${API_BASE}/api/export/mytax?fyId=${fyId}`;

  return (
    <div>
      <h2>Export — FY {selected.label}</h2>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Download your FY {selected.label} tax data for your accountant or for self-lodgement via myTax.
      </p>
      <div className="export-cards">
        <ExportCard
          title="Accountant export"
          description="Excel spreadsheet with separate sheets for salary, dividends, capital gains, and rental property — formatted for your accountant or a professional tax review."
          buttonLabel="Download Excel (.xlsx)"
          url={accountantUrl}
        />
        <ExportCard
          title="myTax guide"
          description="Step-by-step guide mapped to myTax screens, showing exactly what to enter and where. Download and refer to it while lodging online at my.gov.au."
          buttonLabel="Download myTax Guide (.html)"
          url={mytaxUrl}
        />
      </div>
    </div>
  );
}
