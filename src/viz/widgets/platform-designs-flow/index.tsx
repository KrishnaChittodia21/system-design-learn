// Platform designs, end to end. One card with a design picker; each design is its own view with
// its own pure simulation (sim*.ts) and stepper.
import { useEffect, useRef, useState } from 'react';
import { Choice } from '../../core';
import BrokerView from './BrokerView';
import CalView from './CalView';
import ChessView from './ChessView';
import CiView from './CiView';
import RagView from './RagView';

type Design = 'broker' | 'ci' | 'chess' | 'cal' | 'rag';

export default function PlatformDesignsFlow() {
  const [design, setDesign] = useState<Design>('broker');
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
        { value: 'broker', label: 'Brokerage' },
        { value: 'ci', label: 'CI runners' },
        { value: 'chess', label: 'Chess server' },
        { value: 'cal', label: 'Calendar' },
        { value: 'rag', label: 'RAG Q&A' },
      ]}
      onChange={(d) => {
        picked.current = true;
        setDesign(d);
      }}
    />
  );
  const view =
    design === 'ci' ? <CiView picker={picker} /> : design === 'chess' ? <ChessView picker={picker} /> : design === 'cal' ? <CalView picker={picker} /> : design === 'rag' ? <RagView picker={picker} /> : <BrokerView picker={picker} />;
  return <div ref={root}>{view}</div>;
}
