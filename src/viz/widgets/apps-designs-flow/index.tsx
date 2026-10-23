// App designs, end to end. One card with a design picker; each design is its own view with its
// own pure simulation (sim.ts) and stepper.
import { useEffect, useRef, useState } from 'react';
import { Choice } from '../../core';
import FoodView from './FoodView';
import InstaView from './InstaView';

type Design = 'insta' | 'food';

export default function AppsDesignsFlow() {
  const [design, setDesign] = useState<Design>('insta');
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
        { value: 'insta', label: 'Instagram post' },
        { value: 'food', label: 'Food delivery order' },
      ]}
      onChange={(d) => {
        picked.current = true;
        setDesign(d);
      }}
    />
  );
  return <div ref={root}>{design === 'food' ? <FoodView picker={picker} /> : <InstaView picker={picker} />}</div>;
}
