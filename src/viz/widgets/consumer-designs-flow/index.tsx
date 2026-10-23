// Consumer designs, end to end. One card with a design picker; each design is its own view with
// its own pure simulation (sim.ts) and stepper.
import { useEffect, useRef, useState } from 'react';
import { Choice } from '../../core';
import MatchView from './MatchView';
import PriceView from './PriceView';
import SaleView from './SaleView';

type Design = 'sale' | 'price' | 'tinder';

export default function ConsumerDesignsFlow() {
  const [design, setDesign] = useState<Design>('sale');
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
        { value: 'sale', label: 'Flash sale' },
        { value: 'price', label: 'Price alerts' },
        { value: 'tinder', label: 'Tinder match' },
      ]}
      onChange={(d) => {
        picked.current = true;
        setDesign(d);
      }}
    />
  );
  return (
    <div ref={root}>
      {design === 'price' ? <PriceView picker={picker} /> : design === 'tinder' ? <MatchView picker={picker} /> : <SaleView picker={picker} />}
    </div>
  );
}
