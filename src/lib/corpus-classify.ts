export type NoteClass = "unchanged" | "restyle" | "content lost";

export interface NoteFacts {
  text: string;
  links: string[];
  images: string[];
  hardBreaks: number;
  frontMatter: string | null;
}

export interface Classification {
  class: NoteClass;
  reasons: string[];
  nonConvergent: boolean;
}

export function classifyNote(_input: {
  original: string;
  saved: string;
  resaved: string;
  before: NoteFacts;
  after: NoteFacts;
}): Classification {
  return { class: "unchanged", reasons: [], nonConvergent: false };
}
