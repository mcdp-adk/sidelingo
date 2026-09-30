// PROTOTYPE, throwaway: "How should the three Display modes lay out in the Pin window?"
// Four side-by-side layouts, switchable via ?variant=A|B|C|D. Source-only and translation-only
// are shared single-column views. Streaming is simulated; nothing calls a model.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button, FluentProvider, Spinner, Tab, TabList, Tooltip, webDarkTheme, webLightTheme,
} from "@fluentui/react-components";
import { Copy16Regular, Dismiss16Regular, Settings16Regular } from "@fluentui/react-icons";
import { Streamdown, parseMarkdownIntoBlocks } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { samples } from "./samples";

type Mode = "source" | "translation" | "both";
type Phase = "structuring" | "translating" | "done";
const variants = [
  { key: "A", name: "Two columns" },
  { key: "B", name: "Aligned rows" },
  { key: "C", name: "Interleaved" },
  { key: "D", name: "Split panes" },
] as const;

function useParam(name: string, fallback: string) {
  const [value, setValue] = useState(() => new URLSearchParams(location.search).get(name) ?? fallback);
  const set = (v: string) => {
    const p = new URLSearchParams(location.search);
    p.set(name, v);
    history.replaceState(null, "", `?${p}`);
    setValue(v);
  };
  return [value, set] as const;
}

function useDark(force: string) {
  const mq = useMemo(() => matchMedia("(prefers-color-scheme: dark)"), []);
  const [sys, setSys] = useState(mq.matches);
  useEffect(() => {
    const on = () => setSys(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mq]);
  return force === "system" ? sys : force === "dark";
}

export function App() {
  const [variant, setVariant] = useParam("variant", "A");
  const [mode, setMode] = useParam("mode", "both");
  const [sampleKey, setSampleKey] = useParam("sample", "en-zh");
  const [theme, setTheme] = useParam("theme", "system");
  const [useCjk, setUseCjk] = useState(true);
  const [controls, setControls] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [width, setWidth] = useState(460);
  const [height, setHeight] = useState(560);
  const [measured, setMeasured] = useState({ w: 0, h: 0 });
  const dark = useDark(theme);
  const sample = samples.find((s) => s.key === sampleKey) ?? samples[0];

  // Simulated Round: Structuring streams Source text, then Translation streams Translated text.
  const [srcLen, setSrcLen] = useState(0);
  const [tgtLen, setTgtLen] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let s = sample.fastPath ? sample.src.length : 0;
    let t = 0;
    setSrcLen(s);
    setTgtLen(0);
    const id = setInterval(() => {
      if (s < sample.src.length) { s = Math.min(sample.src.length, s + speed); setSrcLen(s); }
      else if (t < sample.tgt.length) { t = Math.min(sample.tgt.length, t + speed); setTgtLen(t); }
      else clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  }, [sample, speed, run]);
  const phase: Phase = srcLen < sample.src.length ? "structuring" : tgtLen < sample.tgt.length ? "translating" : "done";
  const src = sample.src.slice(0, srcLen);
  const tgt = sample.tgt.slice(0, tgtLen);

  const pinRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setMeasured({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(pinRef.current!);
    return () => ro.disconnect();
  }, []);

  const md = (text: string, streaming: boolean) => (
    <Streamdown className="md" plugins={useCjk ? { cjk } : undefined} isAnimating={streaming} controls={controls}>
      {text}
    </Streamdown>
  );
  const view: View = { src, tgt, phase, md };
  const V = variant === "B" ? AlignedRows : variant === "C" ? Interleaved : variant === "D" ? SplitPanes : TwoColumns;

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} className={dark ? "dark" : ""} style={{ height: "100%" }}>
      <div className="desk">
        <div
          ref={pinRef}
          className="pin"
          style={{ width, height, background: "var(--colorNeutralBackground1)", color: "var(--colorNeutralForeground1)" }}
        >
          <div
            className={`pin-toolbar${toolbarPinned ? " pinned" : ""}`}
            style={{ background: "var(--colorNeutralBackground1)", boxShadow: "0 1px 0 var(--colorNeutralStroke2)" }}
          >
            <TabList size="small" selectedValue={mode} onTabSelect={(_, d) => setMode(d.value as string)}>
              <Tab value="source">原文</Tab>
              <Tab value="translation">译文</Tab>
              <Tab value="both">对照</Tab>
            </TabList>
            <span style={{ flex: 1 }} />
            <Tooltip content="复制" relationship="label"><Button size="small" appearance="subtle" icon={<Copy16Regular />} /></Tooltip>
            <Tooltip content="设置" relationship="label"><Button size="small" appearance="subtle" icon={<Settings16Regular />} /></Tooltip>
            <Tooltip content="关闭" relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss16Regular />} /></Tooltip>
          </div>
          {mode === "both" ? (
            <V {...view} />
          ) : (
            <div className="pin-scroll">
              {mode === "source"
                ? !src ? <Pending label="整理中…" /> : md(src, phase === "structuring")
                : phase === "structuring" ? <Pending label="整理中…" />
                : tgt ? md(tgt, phase === "translating") : <Pending label="翻译中…" />}
            </div>
          )}
        </div>
      </div>

      <DevPanel>
        <b>PROTOTYPE · 窗口 {measured.w}×{measured.h}（可拖右下角调整）</b>
        <Row label="宽度">{[300, 380, 460, 600, 820].map((w) => <Chip key={w} on={width === w} onClick={() => setWidth(w)}>{w}</Chip>)}</Row>
        <Row label="高度">{[240, 400, 560, 720].map((h) => <Chip key={h} on={height === h} onClick={() => setHeight(h)}>{h}</Chip>)}</Row>
        <Row label="样本">{samples.map((s) => <Chip key={s.key} on={sampleKey === s.key} onClick={() => setSampleKey(s.key)}>{s.label}</Chip>)}</Row>
        <Row label="流式">
          <Chip on={false} onClick={() => setRun((r) => r + 1)}>重放</Chip>
          {[1, 4, 16, 9999].map((n) => <Chip key={n} on={speed === n} onClick={() => setSpeed(n)}>{n === 9999 ? "瞬间" : `${n} 字/30ms`}</Chip>)}
          <span style={{ opacity: 0.7 }}>· {phase}</span>
        </Row>
        <Row label="渲染">
          <Chip on={useCjk} onClick={() => setUseCjk(!useCjk)}>@streamdown/cjk</Chip>
          <Chip on={controls} onClick={() => setControls(!controls)}>表格/代码按钮</Chip>
          <Chip on={toolbarPinned} onClick={() => setToolbarPinned(!toolbarPinned)}>常显工具栏</Chip>
        </Row>
        <Row label="主题">{["system", "light", "dark"].map((t) => <Chip key={t} on={theme === t} onClick={() => setTheme(t)}>{t}</Chip>)}</Row>
      </DevPanel>
      <Switcher current={variant} onChange={setVariant} />
    </FluentProvider>
  );
}

type View = { src: string; tgt: string; phase: Phase; md: (text: string, streaming: boolean) => ReactNode };

function Pending({ label }: { label: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.8 }}><Spinner size="extra-tiny" />{label}</div>;
}

function TgtOrPending({ tgt, phase, md }: View) {
  if (phase === "structuring") return <div style={{ opacity: 0.6, fontSize: 13 }}>等待整理完成…</div>;
  return tgt ? <>{md(tgt, phase === "translating")}</> : <Pending label="翻译中…" />;
}

// A: whole Source text in one column, whole Translated text in the other; stacks below 560px.
function TwoColumns(v: View) {
  return (
    <div className="pin-scroll">
      <div className="two-col">
        <div className="col">{v.md(v.src, v.phase === "structuring")}</div>
        <div className="col"><TgtOrPending {...v} /></div>
      </div>
    </div>
  );
}

// Pairs blocks by index, using the same splitter Streamdown uses internally.
function pairs(src: string, tgt: string) {
  const split = (s: string) => (s ? parseMarkdownIntoBlocks(s).filter((b) => b.trim()) : []);
  const a = split(src);
  const b = split(tgt);
  return { a, b, n: Math.max(a.length, b.length) };
}

function Mismatch({ a, b }: { a: string[]; b: string[] }) {
  return <div className="mismatch">块数不一致：原文 {a.length} 块，译文 {b.length} 块，按序号配对已错位</div>;
}

// B: blocks paired by index in a two-column grid; each pair stacks below 560px.
function AlignedRows(v: View) {
  const { a, b, n } = pairs(v.src, v.tgt);
  return (
    <div className="pin-scroll">
      {v.phase === "done" && a.length !== b.length && <Mismatch a={a} b={b} />}
      <div className="rows">
        {Array.from({ length: n }, (_, i) => [
          <div key={`s${i}`} className="cell src">{a[i] ? v.md(a[i], v.phase === "structuring" && i === a.length - 1) : null}</div>,
          <div key={`t${i}`} className="cell tgt">
            {b[i] ? v.md(b[i], v.phase === "translating" && i === b.length - 1)
              : v.phase !== "done" ? <div className="pending" style={{ width: "70%" }} /> : null}
          </div>,
        ])}
      </div>
    </div>
  );
}

// C: Read Frog style bilingual flow: each source block, then its translation, one column at every width.
function Interleaved(v: View) {
  const { a, b, n } = pairs(v.src, v.tgt);
  return (
    <div className="pin-scroll">
      {v.phase === "done" && a.length !== b.length && <Mismatch a={a} b={b} />}
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="pair">
          {a[i] && <div className="src">{v.md(a[i], v.phase === "structuring" && i === a.length - 1)}</div>}
          <div className="tgt">
            {b[i] ? v.md(b[i], v.phase === "translating" && i === b.length - 1)
              : v.phase !== "done" ? <div className="pending" style={{ width: "60%" }} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// D: two panes that scroll independently: top/bottom when narrow, left/right from 640px.
function SplitPanes(v: View) {
  return (
    <div className="split">
      <div className="pane"><div className="lang-tag">原文</div>{v.md(v.src, v.phase === "structuring")}</div>
      <div className="pane"><div className="lang-tag">译文</div><TgtOrPending {...v} /></div>
    </div>
  );
}

function DevPanel({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "fixed", top: 12, right: 12, width: 380, zIndex: 50, padding: 12, borderRadius: 12, background: "#111", color: "#eee", font: "12px/1.5 system-ui", boxShadow: "0 6px 24px rgba(0,0,0,.5)", display: "grid", gap: 6 }}>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}><span style={{ width: 32, opacity: 0.6 }}>{label}</span>{children}</div>;
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} style={{ border: 0, borderRadius: 999, padding: "2px 8px", cursor: "pointer", font: "inherit", background: on ? "#ffd400" : "#333", color: on ? "#111" : "#eee" }}>{children}</button>;
}

function Switcher({ current, onChange }: { current: string; onChange: (v: string) => void }) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  if (import.meta.env.PROD) return null;
  const btn = { border: 0, background: "transparent", color: "#111", fontSize: 18, cursor: "pointer", padding: "0 10px" };
  return (
    <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 50, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderRadius: 999, background: "#ffd400", color: "#111", font: "600 13px system-ui", boxShadow: "0 6px 24px rgba(0,0,0,.5)" }}>
      <button style={btn} onClick={() => go(-1)}>←</button>
      <span>对照布局 {variants[i].key} · {variants[i].name}</span>
      <button style={btn} onClick={() => go(1)}>→</button>
    </div>
  );
}
