export interface FrontMatter {
  raw: string;
  yaml: string;
  open: string;
  eol: string;
  after: string;
}

export function splitFrontMatter(text: string): {
  frontMatter: FrontMatter | null;
  body: string;
} {
  return { frontMatter: null, body: text };
}

export function withYaml(frontMatter: FrontMatter, yaml: string): FrontMatter {
  return { ...frontMatter, yaml };
}
