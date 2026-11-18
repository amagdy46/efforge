export type TokenKind =
  | "comment"
  | "keyword"
  | "string"
  | "function"
  | "number"
  | "type"
  | "punctuation"
  | "plain"

export interface Token {
  readonly kind: TokenKind
  readonly text: string
}

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "false",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "readonly",
  "return",
  "satisfies",
  "static",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "void",
  "while",
  "yield",
])

// One alternative per token kind, tried left to right at each position.
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=<>+\-*/!?&|%^~@]+)|(\s+)|(.)/g

/**
 * Splits TypeScript source into coloured tokens. A small lexer rather than a grammar: comments,
 * strings, numbers, keywords, types (capitalised names), calls and punctuation, which is what a
 * ten-line snippet needs, with no dependency in the Worker bundle.
 */
export const highlight = (source: string): ReadonlyArray<Token> => {
  const tokens: Token[] = []
  for (const match of source.matchAll(TOKEN)) {
    const [text, comment, string, number, word, punctuation] = match
    const next = source.slice((match.index ?? 0) + text.length).trimStart()
    let kind: TokenKind = "plain"
    if (comment !== undefined) kind = "comment"
    else if (string !== undefined) kind = "string"
    else if (number !== undefined) kind = "number"
    else if (word !== undefined) {
      if (KEYWORDS.has(word)) kind = "keyword"
      else if (next.startsWith("(") || next.startsWith("`")) kind = "function"
      else if (/^[A-Z]/.test(word)) kind = "type"
    } else if (punctuation !== undefined) kind = "punctuation"
    const last = tokens.at(-1)
    if (last !== undefined && last.kind === kind && kind === "plain")
      tokens[tokens.length - 1] = { kind, text: last.text + text }
    else tokens.push({ kind, text })
  }
  return tokens
}
