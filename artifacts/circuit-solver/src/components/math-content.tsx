import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

type Segment =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;

function parseMixed(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      out.push({ type: "math", value: m[1].trim(), display: true });
    } else if (m[2] !== undefined) {
      out.push({ type: "math", value: m[2].trim(), display: false });
    } else if (m[3] !== undefined) {
      out.push({ type: "math", value: m[3].trim(), display: true });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ type: "text", value: text.slice(last) });
  }
  return out;
}

function renderTeX(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: "ignore" as const,
      output: "html",
      trust: false,
    });
  } catch {
    return escapeHtml(tex);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

interface MathContentProps {
  children: string;
  formula?: boolean;
  className?: string;
}

export default function MathContent({
  children,
  formula = false,
  className,
}: MathContentProps) {
  const html = useMemo(() => {
    if (formula) {
      return renderTeX(children, true);
    }
    const segs = parseMixed(children);
    if (segs.length === 0) return "";
    return segs
      .map((s) =>
        s.type === "text"
          ? escapeHtml(s.value)
          : renderTeX(s.value, s.display),
      )
      .join("");
  }, [children, formula]);

  if (formula) {
    return (
      <div
        className={className}
        data-testid="math-formula"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <span
      className={className}
      data-testid="math-inline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
