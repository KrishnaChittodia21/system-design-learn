// Classic designs, end to end. One card with a design picker; each design is its own view with
// its own pure simulation (sim.ts) and stepper.
import { useEffect, useRef, useState } from 'react';
import { Choice } from '../../core';
import NotifyView from './NotifyView';
import SnowView from './SnowView';
import UrlView from './UrlView';

type Design = 'url' | 'snowflake' | 'notify';

export default function ClassicDesignsFlow() {
  const [design, setDesign] = useState<Design>('url');
  const root = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
  // switching design remounts the card; keep keyboard focus on the chosen design chip
  useEffect(() => {
    if (!picked.current) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-label="Design"] .chip.on')?.focus();
  }, [design]);
  const picker = (
    <Choice<Design>
      label="Design"
      value={design}
      options={[
        { value: 'url', label: 'URL shortener' },
        { value: 'snowflake', label: 'Snowflake IDs' },
        { value: 'notify', label: 'Notifications' },
      ]}
      onChange={(d) => {
        picked.current = true;
        setDesign(d);
      }}
    />
  );
  return (
    <div ref={root}>
      {design === 'snowflake' ? <SnowView picker={picker} /> : design === 'notify' ? <NotifyView picker={picker} /> : <UrlView picker={picker} />}
    </div>
  );
}
