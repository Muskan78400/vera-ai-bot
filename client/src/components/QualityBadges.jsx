import { CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { checkMessageQuality } from '../utils/qualityCheck.js';

export default function QualityBadges({ body }) {
  if (!body) return null;
  const { checks, passCount, total } = checkMessageQuality(body);
  const allPass = passCount === total;

  return (
    <div className="quality-badges-wrap">
      <div className="quality-summary">
        <ShieldCheck size={14} strokeWidth={2.2} />
        Quality check:{' '}
        <strong className={allPass ? 'quality-all-pass' : ''}>
          {passCount}/{total}
        </strong>
      </div>
      <div className="quality-badges">
        {checks.map((c, i) => (
          <div key={i} className={`quality-badge ${c.pass ? 'pass' : 'fail'}`} title={c.detail}>
            {c.pass ? (
              <CheckCircle2 size={13} strokeWidth={2.4} />
            ) : (
              <XCircle size={13} strokeWidth={2.4} />
            )}
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}
