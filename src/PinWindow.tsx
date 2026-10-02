import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  makeStyles,
  mergeClasses,
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Select,
  Tab,
  TabList,
  Text,
  Toolbar,
  Tooltip,
  tokens,
  type PositioningVirtualElement,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  CopyRegular,
  DocumentCopyRegular,
  DismissRegular,
  PauseRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { strings } from "./i18n";
import type { RoundError } from "./round";
import { regenerate, toggleClipboardPause, useSession } from "./session";
import { DISPLAY_MODES, type DisplayMode } from "./settings";
import { patchSettings, useSettings } from "./settings-store";

/** How far the pointer travels before a plain drag moves the window, like Windows' own SM_CXDRAG. */
const DRAG_THRESHOLD = 4;
/** How long the scrollbar stays after the last scroll or pointer movement, in milliseconds. */
const SCROLLBAR_LINGER = 1000;
/** Includes trailing scroll events after a wheel, key or pointer release. */
const SCROLL_INTENT_LINGER = 400;

const hide = () => invoke("hide_pin_window");
const plugins = { cjk };
const modeLabels: Record<DisplayMode, string> = {
  source: strings.sourceMode,
  translation: strings.translationMode,
  both: strings.sideBySideMode,
};
const selectMode = (displayMode: DisplayMode) =>
  void patchSettings({ displayMode }).catch((reason) => console.error("Display mode was not saved:", reason));

function errorTitle(error: RoundError): string {
  const stage = error.stage === "structuring" ? strings.structuringFailed : strings.translationFailed;
  const category =
    error.category === "network"
      ? strings.networkError
      : error.category === "provider-http"
        ? strings.providerHttpError
        : error.category === "provider-error"
          ? strings.providerError
          : strings.emptyResponseError;
  return `${stage}: ${category}${error.status === undefined ? "" : ` ${error.status}`}`;
}

const useStyles = makeStyles({
  root: { position: "relative", height: "100vh", overflow: "hidden" },
  paused: {
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      border: `2px solid ${tokens.colorStatusWarningBorder2}`,
      borderRadius: tokens.borderRadiusXLarge,
      pointerEvents: "none",
    },
  },
  // Overlays the content with no reserved space, shown while the pointer is over the window.
  toolbar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalXS,
    backgroundColor: tokens.colorNeutralBackgroundAlpha,
    backdropFilter: "blur(20px)",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    ":focus-within": { opacity: 1 },
  },
  shown: { opacity: 1 },
  modeControls: { position: "relative", flexGrow: 1, minWidth: 0 },
  tabs: { width: "max-content" },
  measuringTabs: { position: "absolute", visibility: "hidden", pointerEvents: "none" },
  dropdown: { width: "100%", minWidth: 0 },
  dropdownInput: { minWidth: 0, textOverflow: "ellipsis" },
  actions: { display: "flex", flexShrink: 0 },
  panes: { display: "grid", height: "100%", gridTemplateColumns: "minmax(0, 1fr)" },
  columns: { gridTemplateColumns: "minmax(0, 1fr) 1px minmax(0, 1fr)" },
  rows: { gridTemplateRows: "minmax(0, 1fr) 1px minmax(0, 1fr)" },
  divider: { backgroundColor: tokens.colorNeutralStroke2 },
  content: {
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    overflowY: "auto",
    overflowAnchor: "none",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    cursor: "default",
    // A thin, rounded Fluent scrollbar with no arrow buttons, shown only while in use.
    "::-webkit-scrollbar": { width: "6px" },
    "::-webkit-scrollbar-thumb": { borderRadius: tokens.borderRadiusCircular },
  },
  status: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  errorDetail: { whiteSpace: "pre-wrap" },
  source: { color: tokens.colorNeutralForeground3 },
  scrollbarShown: { "::-webkit-scrollbar-thumb": { backgroundColor: tokens.colorNeutralForeground3 } },
});

/** A press on the content's own scrollbar, which drags the thumb rather than the window. */
function onScrollbar(e: MouseEvent<HTMLElement>): boolean {
  const content = e.currentTarget;
  return e.target === content && e.clientX - content.getBoundingClientRect().left >= content.clientWidth;
}

/** Inline controls keep their normal pointer behavior rather than moving or hiding the window. */
function interactiveTarget(target: EventTarget): boolean {
  return (
    target instanceof Element && target.closest("button, a[href], input, select, textarea, [role=button]") !== null
  );
}

export function PinWindow() {
  const styles = useStyles();
  const { round, hasInput, paused, overlong } = useSession();
  const mode = useSettings().displayMode;
  const root = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const contents = useRef<(HTMLDivElement | null)[]>([]);
  const scrollDriver = useRef<{ index: number; until: number } | null>(null);
  const [tall, setTall] = useState(false);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const [pointerOver, setPointerOver] = useState(false);
  const [scrollbarShown, setScrollbarShown] = useState(false);
  const scrollbarTimer = useRef<number>(undefined);
  const [menu, setMenu] = useState<{ target: PositioningVirtualElement; selection: string } | null>(null);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setTall(entry.contentRect.width < entry.contentRect.height));
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const bar = toolbar.current!;
      const style = getComputedStyle(bar);
      const spacing =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + (parseFloat(style.columnGap) || 0);
      setCompact(
        tabs.current!.getBoundingClientRect().width + actions.current!.getBoundingClientRect().width + spacing >
          bar.clientWidth,
      );
    };
    const observer = new ResizeObserver(measure);
    [toolbar.current!, tabs.current!, actions.current!].forEach((element) => observer.observe(element));
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey &&
        ((e.ctrlKey && e.key.toLowerCase() === "r") || (!e.ctrlKey && e.key === "F5"))
      ) {
        e.preventDefault();
        regenerate();
      }
      const mode = DISPLAY_MODES[Number(e.key) - 1];
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && /^[123]$/.test(e.key) && mode) {
        e.preventDefault();
        selectMode(mode);
      }
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        void invoke("open_settings");
      }
      // Esc in the right-click menu closes only the menu.
      if (e.key === "Escape" && !(e.target as Element).closest("[role=menu]")) void hide();
    };
    // The window drag starts only past the threshold, so a click never loses its mouse-up to it
    // (tauri-apps/tauri#10767).
    const onMouseMove = (e: globalThis.MouseEvent) => {
      const start = pressedAt.current;
      if (!start || !(e.buttons & 1)) return;
      if (Math.hypot(e.screenX - start.x, e.screenY - start.y) < DRAG_THRESHOLD) return;
      pressedAt.current = null;
      void getCurrentWindow().startDragging();
    };
    const onMouseUp = () => {
      pressedAt.current = null;
      if (scrollDriver.current?.until === Infinity) {
        scrollDriver.current.until = performance.now() + SCROLL_INTENT_LINGER;
      }
    };
    const onPointerCancel = () => {
      pressedAt.current = null;
      scrollDriver.current = null;
    };
    // A hidden window hears no mouseleave, and shows again with neither toolbar nor menu.
    const unlistenHidden = listen("pin-window-hidden", () => {
      setPointerOver(false);
      setMenu(null);
      onPointerCancel();
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onPointerCancel);
    return () => {
      clearTimeout(scrollbarTimer.current);
      void unlistenHidden.then((unlisten) => unlisten());
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onPointerCancel);
    };
  }, []);

  // Each new Round starts at the top; updates within a Round leave the scroll where it is.
  useLayoutEffect(() => {
    scrollDriver.current = null;
    contents.current.forEach((content) => content?.scrollTo({ top: 0 }));
  }, [round?.id]);

  const showScrollbar = () => {
    setScrollbarShown(true);
    clearTimeout(scrollbarTimer.current);
    scrollbarTimer.current = setTimeout(() => setScrollbarShown(false), SCROLLBAR_LINGER);
  };

  const onScroll = (index: number) => {
    showScrollbar();
    const driver = scrollDriver.current;
    if (mode !== "both" || driver?.index !== index || performance.now() >= driver.until) return;
    const content = contents.current[index]!;
    const other = contents.current[1 - index]!;
    const max = content.scrollHeight - content.clientHeight;
    other.scrollTop = (max > 0 ? content.scrollTop / max : 0) * (other.scrollHeight - other.clientHeight);
  };

  const markScrollIntent = (index: number) => {
    scrollDriver.current = { index, until: performance.now() + SCROLL_INTENT_LINGER };
  };

  const onDragMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.ctrlKey || interactiveTarget(e.target)) return;
    // Without Ctrl a press only moves the window, so it neither selects text nor clears a selection.
    e.preventDefault();
    pressedAt.current = { x: e.screenX, y: e.screenY };
  };

  const onEmptyToolbarMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) onDragMouseDown(e);
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (!e.ctrlKey && !onScrollbar(e)) getSelection()?.removeAllRanges();
  };

  // The only menu is "Copy selection", so without a selection there is none, not even the WebView's.
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const selection = getSelection()?.toString() ?? "";
    if (!selection.trim()) return;
    const at = new DOMRect(e.clientX, e.clientY);
    setMenu({ target: { getBoundingClientRect: () => at }, selection });
  };

  const onDoubleClick = (e: MouseEvent<HTMLElement>) => {
    if (!e.ctrlKey && !onScrollbar(e) && !interactiveTarget(e.target)) void hide();
  };

  const pane = (kind: "source" | "translation") => {
    const index = kind === "source" ? 0 : 1;
    const state = round?.state;
    const result = state?.[kind];
    return (
      <div
        key={kind}
        ref={(element) => {
          contents.current[index] = element;
        }}
        role="region"
        aria-label={modeLabels[kind]}
        tabIndex={0}
        className={mergeClasses(styles.content, scrollbarShown && styles.scrollbarShown)}
        onWheel={() => markScrollIntent(index)}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " "].includes(e.key)) {
            markScrollIntent(index);
          }
        }}
        onScroll={() => onScroll(index)}
        onMouseMove={showScrollbar}
        onMouseDown={(e) => {
          if (onScrollbar(e)) {
            // A native thumb drag owns scrolling until mouse-up, however long it is held.
            if (e.button === 0) scrollDriver.current = { index, until: Infinity };
          } else onDragMouseDown(e);
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {overlong ? (
          <MessageBar intent="info">
            <MessageBarBody>
              <MessageBarTitle>{strings.overlongText}</MessageBarTitle>
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={regenerate}>
                {strings.processAnyway}
              </Button>
            </MessageBarActions>
          </MessageBar>
        ) : round && state && result ? (
          state.outcome === "no-text" ? (
            <MessageBar intent="info">
              <MessageBarBody>
                <MessageBarTitle>{strings.noTextInImage}</MessageBarTitle>
              </MessageBarBody>
            </MessageBar>
          ) : (
            <>
              {result.text && <Streamdown plugins={plugins}>{result.text}</Streamdown>}
              {!result.text && state.outcome === "running" && (
                <Text as="p" block className={styles.status}>
                  {state.stage === "structuring" ? strings.structuringStatus : strings.translationStatus}
                </Text>
              )}
              {kind === "translation" && mode !== "both" && !result.text && state.source.text && (
                <div className={styles.source}>
                  <Streamdown plugins={plugins}>{state.source.text}</Streamdown>
                </div>
              )}
              {result.error && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>{errorTitle(result.error)}</MessageBarTitle>
                    <Text as="p" block className={styles.errorDetail}>
                      {result.error.detail}
                    </Text>
                  </MessageBarBody>
                </MessageBar>
              )}
            </>
          )
        ) : (
          <Text as="p" block>
            {strings.pinEmptyHint}
          </Text>
        )}
      </div>
    );
  };

  return (
    <div
      ref={root}
      className={mergeClasses(styles.root, paused && styles.paused)}
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
      onContextMenu={onContextMenu}
    >
      <div className={mergeClasses(styles.panes, mode === "both" && (tall ? styles.rows : styles.columns))}>
        {mode === "both" ? (
          <>
            {pane("source")}
            <div role="separator" aria-orientation={tall ? "horizontal" : "vertical"} className={styles.divider} />
            {pane("translation")}
          </>
        ) : (
          pane(mode)
        )}
      </div>
      <Toolbar
        ref={toolbar}
        className={mergeClasses(styles.toolbar, pointerOver && styles.shown)}
        onMouseDown={onEmptyToolbarMouseDown}
      >
        <div className={styles.modeControls} onMouseDown={onEmptyToolbarMouseDown}>
          <TabList
            ref={tabs}
            onMouseDown={onEmptyToolbarMouseDown}
            className={mergeClasses(styles.tabs, compact && styles.measuringTabs)}
            aria-hidden={compact || undefined}
            inert={compact}
            size="small"
            selectedValue={mode}
            onTabSelect={(_, data) => selectMode(data.value as DisplayMode)}
          >
            {DISPLAY_MODES.map((value) => (
              <Tab key={value} value={value}>
                {modeLabels[value]}
              </Tab>
            ))}
          </TabList>
          {compact && (
            <Select
              aria-label={strings.displayMode}
              size="small"
              className={styles.dropdown}
              select={{ className: styles.dropdownInput }}
              value={mode}
              onChange={(_, data) => selectMode(data.value as DisplayMode)}
            >
              {DISPLAY_MODES.map((value) => (
                <option key={value} value={value}>
                  {modeLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div ref={actions} className={styles.actions} onMouseDown={onEmptyToolbarMouseDown}>
          <Tooltip content={strings.pauseClipboardMonitoring} relationship="label">
            <Button
              size="small"
              appearance={paused ? "primary" : "subtle"}
              icon={<PauseRegular />}
              aria-pressed={paused}
              onClick={toggleClipboardPause}
            />
          </Tooltip>
          <Tooltip content={strings.regenerate} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowClockwiseRegular />}
              disabled={!hasInput}
              onClick={regenerate}
            />
          </Tooltip>
          <Tooltip content={strings.copySource} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<DocumentCopyRegular />}
              disabled={!round?.state.source.text || round.state.source.status !== "done"}
              onClick={() => round && void invoke("copy_text", { text: round.state.source.text })}
            />
          </Tooltip>
          <Tooltip content={strings.copyTranslation} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<CopyRegular />}
              disabled={!round?.state.translation.text || round.state.translation.status !== "done"}
              onClick={() => round && void invoke("copy_text", { text: round.state.translation.text })}
            />
          </Tooltip>
          <Tooltip content={strings.settingsShortcut} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<SettingsRegular />}
              onClick={() => void invoke("open_settings")}
            />
          </Tooltip>
          <Tooltip content={strings.close} relationship="label">
            <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={() => void hide()} />
          </Tooltip>
        </div>
      </Toolbar>
      <Menu
        open={menu !== null}
        onOpenChange={(_, { open }) => open || setMenu(null)}
        positioning={{ target: menu?.target }}
      >
        <MenuPopover>
          <MenuList>
            {/* The menu holds the selection it opened on, since clicking it may clear the live one. */}
            <MenuItem onClick={() => menu && void navigator.clipboard.writeText(menu.selection)}>
              {strings.copySelection}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
