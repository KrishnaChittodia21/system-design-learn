// Pure data + logic for the SOLID refactor stepper. Each stage is a small class diagram taken
// from the topic's own examples (InvoiceService for SRP/OCP, PaymentMethod/COD for LSP, the
// order ports for ISP/DIP). A "change request" is replayed against the current stage to show
// which classes must be edited and which are simply added. No React here.
import type { BaseFrame } from '../../core';

export type Group = 'invoice' | 'payment' | 'order';

export interface Box {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  stereo?: 'interface' | 'abstract';
  members: string[];
  /** visibly wrong in this stage (the smell) */
  smell?: boolean;
  /** package/layer label, used for DIP */
  layer?: 'domain' | 'infra';
}

export interface Edge {
  from: string;
  to: string;
  kind: 'uses' | 'implements' | 'extends' | 'owns' | 'actor';
  bad?: boolean;
  label?: string;
}

export interface Actor {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface Stage extends BaseFrame {
  principle: string;
  headline: string;
  group: Group;
  boxes: Box[];
  edges: Edge[];
  actors: Actor[];
  /** optional layer bands (DIP) */
  layers?: { name: string; y: number; h: number }[];
}

export interface Change {
  id: string;
  group: Group;
  label: string;
}

export interface Impact {
  edit: string[];
  add: string[];
  verdict: 'cheap' | 'costly' | 'broken';
  note: string;
}

export const CHANGES: Change[] = [
  { id: 'bogo', group: 'invoice', label: 'Marketing adds a BOGO discount' },
  { id: 'gst', group: 'invoice', label: 'Finance changes the GST rule' },
  { id: 'layout', group: 'invoice', label: 'Design changes the PDF layout' },
  { id: 'wallet', group: 'payment', label: 'Add a refundable Wallet payment' },
  { id: 'refund-cod', group: 'payment', label: 'Refund a COD order' },
  { id: 'psp', group: 'order', label: 'Swap Razorpay for another PSP' },
  { id: 'report', group: 'order', label: 'Add a read-only revenue report' },
];

const W = 168;

export const STAGES: Stage[] = [
  {
    principle: 'Smell',
    headline: 'One class, four actors',
    group: 'invoice',
    caption:
      'InvoiceServiceBad computes the discount, GST, renders the PDF and emails it. Finance, design, CRM and marketing all request edits to this one file, and every new discount edits the switch.',
    predict: 'With “Marketing adds a BOGO discount” selected above, how many teams’ code do you retest when marketing adds BOGO?',
    actors: [
      { id: 'fin', name: 'Finance', x: 60, y: 40 },
      { id: 'des', name: 'Design', x: 60, y: 120 },
      { id: 'crm', name: 'CRM', x: 60, y: 200 },
      { id: 'mkt', name: 'Marketing', x: 540, y: 120 },
    ],
    boxes: [
      {
        id: 'bad',
        name: 'InvoiceServiceBad',
        x: 216,
        y: 60,
        w: W + 10,
        smell: true,
        members: ['issue(order)', '  sum line items', '  switch (discount.type)', '  gst = total × 18%', '  pdf = "<h1>…"', '  sendMail(…)'],
      },
    ],
    edges: [
      { from: 'fin', to: 'bad', kind: 'actor' },
      { from: 'des', to: 'bad', kind: 'actor' },
      { from: 'crm', to: 'bad', kind: 'actor' },
      { from: 'mkt', to: 'bad', kind: 'actor' },
    ],
  },
  {
    principle: 'SRP',
    headline: 'Split by actor, not by method',
    group: 'invoice',
    caption:
      'SRP: one reason to change = one actor. Tax, rendering and mail each move behind an interface owned by the team that changes it; InvoiceService only sequences the steps. The discount switch is still inside it.',
    actors: [
      { id: 'fin', name: 'Finance', x: 44, y: 34 },
      { id: 'des', name: 'Design', x: 300, y: 34 },
      { id: 'crm', name: 'CRM', x: 556, y: 34 },
      { id: 'mkt', name: 'Marketing', x: 556, y: 250 },
    ],
    boxes: [
      { id: 'svc', name: 'InvoiceService', x: 216, y: 176, w: W, smell: true, members: ['issue(order)', '  switch (discount.type)'] },
      { id: 'tax', name: 'TaxCalculator', x: 8, y: 70, w: W - 10, stereo: 'interface', members: ['taxOn(amount, order)'] },
      { id: 'ren', name: 'InvoiceRenderer', x: 216, y: 70, w: W, stereo: 'interface', members: ['render(inv): Buffer'] },
      { id: 'mail', name: 'InvoiceMailer', x: 434, y: 70, w: W - 10, stereo: 'interface', members: ['send(to, pdf)'] },
    ],
    edges: [
      { from: 'svc', to: 'tax', kind: 'uses' },
      { from: 'svc', to: 'ren', kind: 'uses' },
      { from: 'svc', to: 'mail', kind: 'uses' },
      { from: 'fin', to: 'tax', kind: 'actor' },
      { from: 'des', to: 'ren', kind: 'actor' },
      { from: 'crm', to: 'mail', kind: 'actor' },
      { from: 'mkt', to: 'svc', kind: 'actor' },
    ],
  },
  {
    principle: 'OCP',
    headline: 'Discounts become a registry of rules',
    group: 'invoice',
    caption:
      'OCP: open for extension, closed for modification. Each discount is a DiscountRule registered in a map; InvoiceService looks the rule up instead of switching. New behaviour arrives as new code.',
    actors: [{ id: 'mkt', name: 'Marketing', x: 548, y: 278 }],
    boxes: [
      { id: 'svc', name: 'InvoiceService', x: 8, y: 40, w: W, members: ['rules: Map<type, Rule>', 'issue(order)'] },
      { id: 'tax', name: 'TaxCalculator', x: 8, y: 150, w: W - 10, stereo: 'interface', members: ['taxOn(…)'] },
      { id: 'ren', name: 'InvoiceRenderer', x: 8, y: 214, w: W - 10, stereo: 'interface', members: ['render(…)'] },
      { id: 'rule', name: 'DiscountRule', x: 300, y: 40, w: W, stereo: 'interface', members: ['type', 'apply(subtotal, order)'] },
      { id: 'flat', name: 'FlatDiscount', x: 236, y: 170, w: 140, members: ["type = 'FLAT'"] },
      { id: 'pct', name: 'PercentDiscount', x: 400, y: 170, w: 148, members: ["type = 'PERCENT'"] },
    ],
    edges: [
      { from: 'svc', to: 'rule', kind: 'owns', label: '1..*' },
      { from: 'svc', to: 'tax', kind: 'uses' },
      { from: 'flat', to: 'rule', kind: 'implements' },
      { from: 'pct', to: 'rule', kind: 'implements' },
      { from: 'mkt', to: 'pct', kind: 'actor' },
    ],
  },
  {
    principle: 'LSP ✕',
    headline: 'A subtype that throws breaks every caller',
    group: 'payment',
    caption:
      'LSP violation: CashOnDeliveryBad extends PaymentMethodBad but its refund() throws. The signature compiles; the behaviour lies. Every caller of refund() now needs an instanceof check.',
    predict: 'Where does the instanceof check end up, and what happens when a second non-refundable method arrives?',
    actors: [],
    boxes: [
      { id: 'pm', name: 'PaymentMethodBad', x: 216, y: 30, w: W, stereo: 'abstract', members: ['pay(paise)', 'refund(id, paise)'] },
      { id: 'upi', name: 'UpiBad', x: 100, y: 160, w: 140, members: ['pay()', 'refund() → PSP'] },
      { id: 'cod', name: 'CashOnDeliveryBad', x: 290, y: 160, w: W, smell: true, members: ['pay()', 'refund() → throws!'] },
      { id: 'rs', name: 'RefundService', x: 400, y: 30, w: 190, smell: true, members: ['if (!(m instanceof COD))', '  m.refund(…)'] },
    ],
    edges: [
      { from: 'upi', to: 'pm', kind: 'extends' },
      { from: 'cod', to: 'pm', kind: 'extends', bad: true },
      { from: 'rs', to: 'cod', kind: 'uses', bad: true, label: 'instanceof' },
    ],
  },
  {
    principle: 'LSP ✓',
    headline: 'Contracts only for what a type can honour',
    group: 'payment',
    caption:
      'Fix: split the contract by capability (ISP helps LSP). Payable and Refundable are separate; COD only claims Payable. RefundService asks for Refundable, and the non-refundable path (bank payout) is modelled explicitly.',
    actors: [],
    boxes: [
      { id: 'pay', name: 'Payable', x: 60, y: 30, w: 150, stereo: 'interface', members: ['pay(paise, ref)'] },
      { id: 'ref', name: 'Refundable', x: 300, y: 30, w: 160, stereo: 'interface', members: ['refund(id, paise)'] },
      { id: 'upi', name: 'UpiPayment', x: 170, y: 168, w: 150, members: ['pay()', 'refund()'] },
      { id: 'cod', name: 'CashOnDelivery', x: 8, y: 168, w: 140, members: ['pay()'] },
      { id: 'rs', name: 'RefundService', x: 400, y: 168, w: 190, members: ['isRefundable(m) ? m.refund()', '  : payout.toBankAccount()'] },
    ],
    edges: [
      { from: 'upi', to: 'pay', kind: 'implements' },
      { from: 'upi', to: 'ref', kind: 'implements' },
      { from: 'cod', to: 'pay', kind: 'implements' },
      { from: 'rs', to: 'ref', kind: 'uses' },
    ],
  },
  {
    principle: 'ISP ✕',
    headline: 'A fat interface couples readers to writers',
    group: 'order',
    caption:
      'ISP violation: RevenueReport only reads orders, but it depends on the whole OrderRepository, including save and delete. Its test fake must implement every method, and a change to writes recompiles the report.',
    actors: [],
    boxes: [
      { id: 'repo', name: 'OrderRepository', x: 216, y: 30, w: W, stereo: 'interface', smell: true, members: ['byId(id)', 'save(o, version)', 'delete(id)', 'search(q)', 'purgeOld()'] },
      { id: 'report', name: 'RevenueReport', x: 20, y: 200, w: 160, members: ['uses byId only'] },
      { id: 'payo', name: 'PayOrder', x: 420, y: 200, w: 160, members: ['uses byId + save'] },
    ],
    edges: [
      { from: 'report', to: 'repo', kind: 'uses', bad: true, label: 'all 5 methods' },
      { from: 'payo', to: 'repo', kind: 'uses' },
    ],
  },
  {
    principle: 'ISP ✓',
    headline: 'Interfaces shaped by the client',
    group: 'order',
    caption:
      'Fix: OrderReader and OrderWriter, shaped by what each client needs. RevenueReport depends on OrderReader only, so it cannot accidentally write. One Postgres class can still implement both.',
    actors: [],
    boxes: [
      { id: 'reader', name: 'OrderReader', x: 100, y: 30, w: 150, stereo: 'interface', members: ['byId(id)'] },
      { id: 'writer', name: 'OrderWriter', x: 340, y: 30, w: 160, stereo: 'interface', members: ['save(o, version)'] },
      { id: 'report', name: 'RevenueReport', x: 20, y: 200, w: 160, members: ['(orders: OrderReader)'] },
      { id: 'payo', name: 'PayOrder', x: 420, y: 200, w: 160, members: ['(reader, writer, gateway)'] },
      { id: 'pg', name: 'PgOrderRepo', x: 220, y: 200, w: 150, members: ['byId()', 'save()'] },
    ],
    edges: [
      { from: 'report', to: 'reader', kind: 'uses' },
      { from: 'payo', to: 'reader', kind: 'uses' },
      { from: 'payo', to: 'writer', kind: 'uses' },
      { from: 'pg', to: 'reader', kind: 'implements' },
      { from: 'pg', to: 'writer', kind: 'implements' },
    ],
  },
  {
    principle: 'DIP ✕',
    headline: 'Policy imports the SDK',
    group: 'order',
    caption:
      'DIP violation: PayOrder (high-level policy) imports Razorpay SDK types and calls them directly. The source dependency points outward, from domain to infrastructure, so a vendor change rewrites the use case.',
    actors: [],
    layers: [
      { name: 'domain', y: 24, h: 110 },
      { name: 'infra', y: 166, h: 110 },
    ],
    boxes: [
      { id: 'payo', name: 'PayOrder', x: 180, y: 44, w: 240, smell: true, members: ["import { Razorpay } from 'razorpay'", 'sdk.payments.capture(…)'], layer: 'domain' },
      { id: 'sdk', name: 'Razorpay SDK', x: 190, y: 192, w: 220, members: ['payments.capture(id, amt, cur)'], layer: 'infra' },
    ],
    edges: [{ from: 'payo', to: 'sdk', kind: 'uses', bad: true, label: 'domain → infra' }],
  },
  {
    principle: 'DIP ✓',
    headline: 'The policy owns its port',
    group: 'order',
    caption:
      'Fix: PayOrder declares the PaymentGateway port it needs, in the domain. RazorpayGateway lives in infra, implements the port and maps SDK types. Calls still flow outward; source dependencies now point inward. (DI is just how the adapter gets passed in.)',
    actors: [],
    layers: [
      { name: 'domain', y: 24, h: 110 },
      { name: 'infra', y: 166, h: 110 },
    ],
    boxes: [
      { id: 'payo', name: 'PayOrder', x: 30, y: 44, w: W, members: ['(reader, writer, gateway)'], layer: 'domain' },
      { id: 'port', name: 'PaymentGateway', x: 330, y: 44, w: W + 20, stereo: 'interface', members: ["capture(): 'OK' | 'DECLINED'"], layer: 'domain' },
      { id: 'adapter', name: 'RazorpayGateway', x: 330, y: 192, w: W + 20, members: ['maps SDK → port types'], layer: 'infra' },
      { id: 'sdk', name: 'Razorpay SDK', x: 30, y: 192, w: W, members: ['payments.capture(…)'], layer: 'infra' },
    ],
    edges: [
      { from: 'payo', to: 'port', kind: 'uses' },
      { from: 'adapter', to: 'port', kind: 'implements', label: 'infra → domain' },
      { from: 'adapter', to: 'sdk', kind: 'uses' },
    ],
  },
];

/** What a change request costs at a given stage. */
export function impact(stage: number, change: string): Impact | null {
  const s = STAGES[stage];
  const c = CHANGES.find((x) => x.id === change);
  if (!c || c.group !== s.group) return null;
  const at = s.principle;
  switch (change) {
    case 'bogo':
      if (at === 'Smell')
        return { edit: ['bad'], add: [], verdict: 'costly', note: 'Edit the switch inside the one class that also does tax, PDF and email; all four teams’ behaviour is retested.' };
      if (at === 'SRP')
        return { edit: ['svc'], add: [], verdict: 'costly', note: 'Still edits the switch in InvoiceService (tax, PDF and mail are safe now), but the orchestrator is touched for every promo.' };
      return { edit: [], add: ['BogoDiscount'], verdict: 'cheap', note: 'One new class implementing DiscountRule + one registration line in the module. No tested code is modified.' };
    case 'gst':
      if (at === 'Smell') return { edit: ['bad'], add: [], verdict: 'costly', note: 'The tax line sits beside the PDF and email code; a finance change risks breaking invoices being sent.' };
      return { edit: ['tax'], add: [], verdict: 'cheap', note: 'Only the TaxCalculator implementation changes; finance owns it and nothing else is touched.' };
    case 'layout':
      if (at === 'Smell') return { edit: ['bad'], add: [], verdict: 'costly', note: 'A cosmetic PDF change edits the class that computes money.' };
      return { edit: ['ren'], add: [], verdict: 'cheap', note: 'Only the InvoiceRenderer implementation changes.' };
    case 'wallet':
      if (at === 'LSP ✕')
        return { edit: [], add: ['WalletBad'], verdict: 'costly', note: 'Easy to add, but nothing tells you whether refund() really works: the base class promises it for every subtype.' };
      return { edit: [], add: ['WalletPayment'], verdict: 'cheap', note: 'New class implements Payable & Refundable; RefundService picks it up through the Refundable contract, no edits.' };
    case 'refund-cod':
      if (at === 'LSP ✕')
        return { edit: ['rs'], add: [], verdict: 'broken', note: 'A caller that forgets the instanceof check throws at runtime; each new non-refundable method adds another check in every caller.' };
      return { edit: [], add: [], verdict: 'cheap', note: 'COD is not Refundable, so RefundService takes the explicit bank-payout path. The type system prevents the mismatch.' };
    case 'psp':
      if (at === 'DIP ✕') return { edit: ['payo'], add: [], verdict: 'costly', note: 'The use case itself imports the SDK, so swapping vendors rewrites and retests business logic.' };
      if (at === 'DIP ✓') return { edit: [], add: ['StripeGateway'], verdict: 'cheap', note: 'Add another adapter implementing PaymentGateway and wire it in the composition root. PayOrder is untouched.' };
      return { edit: ['payo'], add: [], verdict: 'costly', note: 'At this stage PayOrder still talks to the SDK directly (the DIP steps fix this).' };
    case 'report':
      if (at === 'ISP ✕')
        return { edit: [], add: ['NewReport'], verdict: 'costly', note: 'The new report must depend on (and its test fake implement) all five methods, including delete and purge.' };
      return { edit: [], add: ['NewReport'], verdict: 'cheap', note: 'Depends on OrderReader only: a one-method fake in tests, and it cannot write by accident.' };
  }
  return null;
}
