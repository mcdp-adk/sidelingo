// PROTOTYPE, throwaway: "How should the three Display modes lay out in the Pin window?"
// Round 2 after owner feedback: side-by-side is variant D (VS Code-style split panes) only, with knobs for
// orientation, divider, proportional scroll sync, and tail-follow. The bottom switcher (?variant=W1|W2|W3)
// cycles what translation-only shows while Structuring runs. Streaming is simulated; nothing calls a model.
// Round 1 (variants A-C: two columns, aligned rows, interleaved) is in this branch's first commit.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button, FluentProvider, Spinner, Tab, TabList, Tooltip, webDarkTheme, webLightTheme,
} from "@fluentui/react-components";
import {
  Checkmark16Regular, Copy16Regular, Dismiss16Regular, Settings16Regular, SplitHorizontal16Regular, SplitVertical16Regular,
} from "@fluentui/react-icons";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { samples } from "./samples";

type Phase = "structuring" | "translating" | "done";
const variants = [
  { key: "W1", name: "Spinner" },
  { key: "W2", name: "Source preview" },
  { key: "W3", name: "Stage steps" },
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

type Opts = { orient: string; manualRows: boolean; sash: string; sync: boolean; follow: boolean };

export function App() {
  const [variant, setVariant] = useParam("variant", "W1");
  const [mode, setMode] = useParam("mode", "both");
  const [sampleKey, setSampleKey] = useParam("sample", "long");
  const [theme, setTheme] = useParam("theme", "system");
  const [orient, setOrient] = useParam("orient", "aspect");
  const [sash, setSash] = useParam("sash", "fixed");
  const [sync, setSync] = useState(true);
  const [follow, setFollow] = useState(false);
  const [manualRows, setManualRows] = useState(false);
  const [speed, setSpeed] = useState(16);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(560);
  const [measured, setMeasured] = useState({ w: 0, h: 0 });
  const [scrollInfo, setScrollInfo] = useState("");
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
    <Streamdown className="md" plugins={{ cjk }} isAnimating={streaming} controls={false}>
      {text}
    </Streamdown>
  );
  const view: View = { src, tgt, phase, md, fastPath: sample.fastPath };
  const opts: Opts = { orient, manualRows, sash, sync, follow };
  const rows = orient === "manual" ? manualRows : orient === "aspect" ? measured.w < measured.h : measured.w < 640;
  const roundKey = `${sample.key}-${run}`;

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
            {mode === "both" && orient === "manual" && (
              <Tooltip content={manualRows ? "左右分屏" : "上下分屏"} relationship="label">
                <Button size="small" appearance="subtle" onClick={() => setManualRows(!manualRows)}
                  icon={manualRows ? <SplitVertical16Regular /> : <SplitHorizontal16Regular />} />
              </Tooltip>
            )}
            <Tooltip content="复制" relationship="label"><Button size="small" appearance="subtle" icon={<Copy16Regular />} /></Tooltip>
            <Tooltip content="设置" relationship="label"><Button size="small" appearance="subtle" icon={<Settings16Regular />} /></Tooltip>
            <Tooltip content="关闭" relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss16Regular />} /></Tooltip>
          </div>
          {mode === "both" ? (
            <SplitPanes key={roundKey} v={view} opts={opts} rows={rows} onInfo={setScrollInfo} />
          ) : (
            <Single key={`${roundKey}-${mode}`} follow={follow} streaming={mode === "source" ? phase === "structuring" : phase === "translating"} text={mode === "source" ? src : tgt}>
              {mode === "source"
                ? !src ? <Pending label="整理中…" /> : md(src, phase === "structuring")
                : <TranslationOnly v={view} variant={variant} />}
            </Single>
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
          {[4, 16, 9999].map((n) => <Chip key={n} on={speed === n} onClick={() => setSpeed(n)}>{n === 9999 ? "瞬间" : `${n} 字/30ms`}</Chip>)}
          <span style={{ opacity: 0.7 }}>· {phase}</span>
        </Row>
        <hr style={{ border: 0, borderTop: "1px solid #333", margin: "2px 0", width: "100%" }} />
        <b>对照（分屏）</b>
        <Row label="方向">
          <Chip on={orient === "aspect"} onClick={() => setOrient("aspect")}>宽≥高 左右</Chip>
          <Chip on={orient === "width"} onClick={() => setOrient("width")}>宽≥640 左右</Chip>
          <Chip on={orient === "manual"} onClick={() => setOrient("manual")}>手动（工具栏按钮）</Chip>
          <span style={{ opacity: 0.7 }}>· 当前{rows ? "上下" : "左右"}</span>
        </Row>
        <Row label="分隔">
          <Chip on={sash === "fixed"} onClick={() => setSash("fixed")}>固定 50/50</Chip>
          <Chip on={sash === "drag"} onClick={() => setSash("drag")}>可拖动</Chip>
        </Row>
        <Row label="滚动">
          <Chip on={sync} onClick={() => setSync(!sync)}>按比例同步</Chip>
          <Chip on={follow} onClick={() => setFollow(!follow)}>流式时跟随末尾</Chip>
        </Row>
        {mode === "both" && <Row label="位置"><span style={{ opacity: 0.8 }}>{scrollInfo}</span></Row>}
        <hr style={{ border: 0, borderTop: "1px solid #333", margin: "2px 0", width: "100%" }} />
        <Row label="其他">
          <Chip on={toolbarPinned} onClick={() => setToolbarPinned(!toolbarPinned)}>常显工具栏</Chip>
          {["system", "light", "dark"].map((t) => <Chip key={t} on={theme === t} onClick={() => setTheme(t)}>{t}</Chip>)}
        </Row>
        <span style={{ opacity: 0.6 }}>底部切换条：译文模式在整理阶段显示什么（切到「译文」再重放）</span>
      </DevPanel>
      <Switcher current={variant} onChange={setVariant} />
    </FluentProvider>
  );
}

type View = { src: string; tgt: string; phase: Phase; fastPath: boolean; md: (text: string, streaming: boolean) => ReactNode };

function Pending({ label }: { label: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.8 }}><Spinner size="extra-tiny" />{label}</div>;
}

// Stick-to-bottom while `streaming`, until the user scrolls away from the bottom.
function useFollow(ref: React.RefObject<HTMLDivElement | null>, on: boolean, streaming: boolean, dep: unknown) {
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (on && streaming && stuck.current && el) el.scrollTop = el.scrollHeight;
  }, [dep, on, streaming]);
  return () => {
    const el = ref.current!;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
}

function Single({ children, follow, streaming, text }: { children: ReactNode; follow: boolean; streaming: boolean; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onScroll = useFollow(ref, follow, streaming, text);
  return <div ref={ref} className="pin-scroll" onScroll={onScroll}>{children}</div>;
}

// Translation-only while Structuring runs: the three treatments on the bottom switcher.
function TranslationOnly({ v, variant }: { v: View; variant: string }) {
  if (v.tgt) return <>{v.md(v.tgt, v.phase === "translating")}</>;
  if (variant === "W2") {
    // Source text streams in muted, then is swapped for the Translated text on its first token.
    return (
      <div>
        <div className="wait-banner"><Spinner size="extra-tiny" />{v.phase === "structuring" ? "整理原文中，译文随后替换" : "翻译中，完成首句后替换"}</div>
        <div style={{ opacity: 0.5 }}>{v.src ? v.md(v.src, v.phase === "structuring") : null}</div>
      </div>
    );
  }
  if (variant === "W3") {
    const lines = Math.min(14, Math.max(2, Math.round(v.src.length / 60)));
    return (
      <div>
        <div className="steps">
          {!v.fastPath && <Step state={v.phase === "structuring" ? "run" : "done"} label="整理" />}
          <Step state={v.phase === "structuring" ? "wait" : "run"} label="翻译" />
        </div>
        {Array.from({ length: lines }, (_, i) => <div key={i} className="pending" style={{ width: `${[92, 78, 85, 60][i % 4]}%` }} />)}
      </div>
    );
  }
  return <Pending label={v.phase === "structuring" ? "整理中…" : "翻译中…"} />;
}

function Step({ state, label }: { state: "wait" | "run" | "done"; label: string }) {
  return (
    <span className={`step ${state}`}>
      {state === "done" ? <Checkmark16Regular /> : state === "run" ? <Spinner size="extra-tiny" /> : <span className="dot" />}
      {label}
    </span>
  );
}

// D: VS Code-style split editor. Panes scroll independently; sync maps scroll position by proportion,
// driven only by the pane the user is actively scrolling (wheel, key, or pointer held).
function SplitPanes({ v, opts, rows, onInfo }: { v: View; opts: Opts; rows: boolean; onInfo: (s: string) => void }) {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const refs = [a, b];
  const userUntil = useRef([0, 0]);
  const held = useRef(-1);
  const followA = useFollow(a, opts.follow, v.phase === "structuring", v.src);
  const followB = useFollow(b, opts.follow, v.phase === "translating", v.tgt);
  const [ratio, setRatio] = useState(0.5);
  const splitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const up = () => { held.current = -1; };
    addEventListener("pointerup", up);
    return () => removeEventListener("pointerup", up);
  }, []);

  const pos = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 0;
  };
  const report = () => {
    if (a.current && b.current) onInfo(`原文 ${Math.round(pos(a.current) * 100)}% · 译文 ${Math.round(pos(b.current) * 100)}%`);
  };
  useEffect(report, [v.src, v.tgt]);

  const onScroll = (i: number) => () => {
    (i === 0 ? followA : followB)();
    report();
    const active = held.current === i || performance.now() < userUntil.current[i];
    if (!opts.sync || !active) return;
    const me = refs[i].current!;
    const other = refs[1 - i].current!;
    other.scrollTop = pos(me) * (other.scrollHeight - other.clientHeight);
  };
  const intent = (i: number) => ({
    onWheel: () => { userUntil.current[i] = performance.now() + 400; },
    onKeyDown: () => { userUntil.current[i] = performance.now() + 400; },
    onPointerDown: () => { held.current = i; },
  });

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = splitRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = rows ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      setRatio(Math.min(0.8, Math.max(0.2, r)));
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const drag = opts.sash === "drag";
  const tracks = `minmax(0, ${drag ? ratio : 0.5}fr) auto minmax(0, ${drag ? 1 - ratio : 0.5}fr)`;
  return (
    <div ref={splitRef} className="split" style={rows ? { gridTemplateRows: tracks } : { gridTemplateColumns: tracks }}>
      <div ref={a} className="pane" tabIndex={0} onScroll={onScroll(0)} {...intent(0)}>
        <div className="lang-tag">原文</div>
        {v.src ? v.md(v.src, v.phase === "structuring") : <Pending label="整理中…" />}
      </div>
      <div
        className={`sash ${rows ? "rows" : "cols"}${drag ? " drag" : ""}`}
        onPointerDown={drag ? startDrag : undefined}
        onDoubleClick={drag ? () => setRatio(0.5) : undefined}
        title={drag ? "拖动调整；双击恢复 50/50" : undefined}
      />
      <div ref={b} className="pane" tabIndex={0} onScroll={onScroll(1)} {...intent(1)}>
        <div className="lang-tag">译文</div>
        {v.phase === "structuring" ? <div style={{ opacity: 0.6, fontSize: 13 }}>等待整理完成…</div>
          : v.tgt ? v.md(v.tgt, v.phase === "translating") : <Pending label="翻译中…" />}
      </div>
    </div>
  );
}

function DevPanel({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "fixed", top: 12, right: 12, width: 400, zIndex: 50, padding: 12, borderRadius: 12, background: "#111", color: "#eee", font: "12px/1.5 system-ui", boxShadow: "0 6px 24px rgba(0,0,0,.5)", display: "grid", gap: 6 }}>
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
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable], .pane, .pin-scroll")) return;
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
      <span>译文模式·整理中 {variants[i].key} · {variants[i].name}</span>
      <button style={btn} onClick={() => go(1)}>→</button>
    </div>
  );
}
