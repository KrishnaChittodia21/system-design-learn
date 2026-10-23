// Location designs, end to end. One card with a design picker; each design is its own view with its
// own pure simulation (sim.ts) and stepper.
import { useEffect, useRef, useState } from 'react';
import { Choice } from '../../core';
import ProxView from './ProxView';
import UberView from './UberView';

type Design = 'prox' | 'uber';

export default function GeoDesignsFlow() {
  const [design, setDesign] = useState<Design>('prox');
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
        { value: 'prox', label: 'Proximity search' },
        { value: 'uber', label: 'Uber matching' },
      ]}
      onChange={(d) => {
        picked.current = true;
        setDesign(d);
      }}
    />
  );
  return <div ref={root}>{design === 'uber' ? <UberView picker={picker} /> : <ProxView picker={picker} />}</div>;
}
