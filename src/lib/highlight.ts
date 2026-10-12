import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-protobuf';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-docker';

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  proto: 'protobuf',
  dockerfile: 'docker',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  redis: 'bash',
  promql: 'text',
};

export function normalizeLang(lang: string | undefined): string {
  const l = (lang ?? 'text').toLowerCase();
  return ALIASES[l] ?? l;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code: string, lang: string | undefined): string {
  const l = normalizeLang(lang);
  const grammar = Prism.languages[l];
  return grammar ? Prism.highlight(code, grammar, l) : escapeHtml(code);
}
