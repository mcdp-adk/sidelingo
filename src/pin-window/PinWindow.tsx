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
import { strings } from "../i18n";
import { ChoiceDropdown } from "../look/ChoiceDropdown";
import { useLayerStyles } from "../look/layers";
import { Markdown } from "../look/Markdown";
import type { RoundError } from "../round/round";
import { useSession, type Session } from "../session/session";
import { DISPLAY_MODES, type ConfigurationFailure, type DisplayMode } from "../settings/settings";
import { patchSettings, useSettings } from "../settings/settings-store";

/** How far the pointer travels before a plain drag moves the window, like Windows' own SM_CXDRAG. */
const DRAG_THRESHOLD = 4;
/** Includes trailing scroll events after a wheel, key or pointer release. */
const SCROLL_INTENT_LINGER = 400;
/** How far from a scroller's right or bottom edge a press reaches its overlay scrollbar, which takes no layout width. */
const SCROLLBAR_REACH = 16;
/** How far below the toolbar the pointer still shows it: the top band the user reaches into. */
const TOOLBAR_REACH = 16;

const hide = () => invoke("hide_pin_window");
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

function configurationFailureMessage(failure: ConfigurationFailure): string {
  switch (failure.kind) {
    case "no-provider":
      return strings.chooseProvider;
    case "missing-model":
      return strings.missingModel;
    case "missing-base-url":
      return strings.missingBaseUrl;
    case "missing-key":
      return failure.cause === "environment-unset"
        ? strings.keyMissingEnvironment(failure.variable)
        : strings.keyUndecryptable;
  }
}

const useStyles = makeStyles({
  root: { position: "relative", height: "100vh", overflow: "hidden" },
  // Overlays the content with no reserved space, on the toolbar layer, shown only while the user reaches for it.
  toolbar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalXS,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    // Keyboard focus shows it too; a mouse click leaves it to fade with the pointer.
    ":has(:focus-visible)": { opacity: 1 },
  },
  shown: { opacity: 1 },
  modeControls: { position: "relative", flexGrow: 1, minWidth: 0 },
  tabs: { width: "max-content" },
  measuringTabs: { position: "absolute", visibility: "hidden", pointerEvents: "none" },
  dropdown: { width: "100%", minWidth: 0 },
  dropdownButton: { minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" },
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
    // Long paths and URLs wrap; only code blocks scroll sideways, inside themselves.
    overflowWrap: "anywhere",
    cursor: "default",
  },
  status: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  errorDetail: { whiteSpace: "pre-wrap" },
});

/**
 * A press on a scrollbar in the content, the pane's own or a code block's or table's, which drags the thumb rather
 * than the window: the press lands on the scroller itself, near its right edge if it scrolls down or its bottom edge
 * if it scrolls sideways.
 */
function onScrollbar(e: MouseEvent<HTMLElement>): boolean {
  const scroller = e.target;
  if (!(scroller instanceof HTMLElement)) return false;
  const { overflowX, overflowY } = getComputedStyle(scroller);
  const scrolls = (overflow: string) => overflow === "auto" || overflow === "scroll";
  const box = scroller.getBoundingClientRect();
  return (
    (scrolls(overflowY) && scroller.scrollHeight > scroller.clientHeight && box.right - e.clientX <= SCROLLBAR_REACH) ||
    (scrolls(overflowX) && scroller.scrollWidth > scroller.clientWidth && box.bottom - e.clientY <= SCROLLBAR_REACH)
  );
}

/** Inline controls keep their normal pointer behavior rather than moving or hiding the window. */
function interactiveTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a[href], input, select, textarea, [role=button], [role=link]") !== null
  );
}

export function PinWindow({ session }: { session: Session }) {
  const styles = useStyles();
  const layers = useLayerStyles();
  const { round, hasInput, paused, overlong, configurationFailure } = useSession(session);
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
  const [pointerNearTop, setPointerNearTop] = useState(false);
  const [modeListOpen, setModeListOpen] = useState(false);
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
      const compact =
        tabs.current!.getBoundingClientRect().width + actions.current!.getBoundingClientRect().width + spacing >
        bar.clientWidth;
      setCompact(compact);
      // The dropdown goes with its list open, and reports no closing.
      if (!compact) setModeListOpen(false);
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
        session.regenerate();
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
      setPointerNearTop(false);
      setModeListOpen(false);
      setMenu(null);
      onPointerCancel();
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onPointerCancel);
    return () => {
      void unlistenHidden.then((unlisten) => unlisten());
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onPointerCancel);
    };
  }, [session]);

  // Each new Round starts at the top; updates within a Round leave the scroll where it is.
  useLayoutEffect(() => {
    scrollDriver.current = null;
    contents.current.forEach((content) => content?.scrollTo({ top: 0 }));
  }, [round?.id]);

  const onScroll = (index: number) => {
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
        className={styles.content}
        onWheel={() => markScrollIntent(index)}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " "].includes(e.key)) {
            markScrollIntent(index);
          }
        }}
        onScroll={() => onScroll(index)}
        onMouseDown={(e) => {
          if (onScrollbar(e)) {
            // A native thumb drag on the pane's own scrollbar owns its scrolling until mouse-up, however long it is held.
            if (e.button === 0 && e.target === e.currentTarget) scrollDriver.current = { index, until: Infinity };
          } else onDragMouseDown(e);
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {configurationFailure && (
          <MessageBar intent={configurationFailure.kind === "missing-key" ? "error" : "info"} layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>{configurationFailureMessage(configurationFailure)}</MessageBarTitle>
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => void invoke("open_settings")}>
                {strings.openSettings}
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}
        {overlong ? (
          <MessageBar intent="info">
            <MessageBarBody>
              <MessageBarTitle>{strings.overlongText}</MessageBarTitle>
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={session.regenerate}>
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
              {result.text && <Markdown text={result.text} />}
              {!result.text && state.outcome === "running" && (
                <Text as="p" block className={styles.status}>
                  {state.stage === "structuring" ? strings.structuringStatus : strings.translationStatus}
                </Text>
              )}
              {kind === "translation" && mode !== "both" && !result.text && state.source.text && (
                <Markdown text={state.source.text} muted />
              )}
              {result.error && (
                <MessageBar intent="error" layout={result.error.offersSettings ? "multiline" : undefined}>
                  <MessageBarBody>
                    <MessageBarTitle>{errorTitle(result.error)}</MessageBarTitle>
                    <Text as="p" block className={styles.errorDetail}>
                      {result.error.detail}
                    </Text>
                    {result.error.hints?.map((hint) => (
                      <Text key={hint} as="p" block>
                        {hint === "image-model-support" ? strings.imageModelHint : strings.reasoningEffortHint}
                      </Text>
                    ))}
                  </MessageBarBody>
                  {result.error.offersSettings && (
                    <MessageBarActions>
                      <Button size="small" onClick={() => void invoke("open_settings")}>
                        {strings.openSettings}
                      </Button>
                    </MessageBarActions>
                  )}
                </MessageBar>
              )}
            </>
          )
        ) : !configurationFailure ? (
          <Text as="p" block>
            {strings.pinEmptyHint}
          </Text>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={root}
      className={mergeClasses(styles.root, paused && layers.pausedFrame)}
      // The top band: the toolbar's height plus a reach below it. Reading never shows the toolbar, wheel-scrolling
      // with the pointer mid-window included.
      onMouseMove={(e) => setPointerNearTop(e.clientY <= toolbar.current!.offsetHeight + TOOLBAR_REACH)}
      onMouseLeave={() => setPointerNearTop(false)}
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
        className={mergeClasses(layers.toolbar, styles.toolbar, (pointerNearTop || modeListOpen) && styles.shown)}
        onMouseDown={onEmptyToolbarMouseDown}
      >
        <div className={styles.modeControls} onMouseDown={onEmptyToolbarMouseDown}>
          <TabList
            ref={tabs}
            onMouseDown={onEmptyToolbarMouseDown}
            className={mergeClasses(styles.tabs, compact && styles.measuringTabs)}
            aria-hidden={compact || undefined}
            inert={compact}
            appearance="subtle"
            size="small"
            selectedValue={mode}
            onTabSelect={(_, data) => selectMode(data.value as DisplayMode)}
          >
            {DISPLAY_MODES.map((value, index) => (
              <Tooltip key={value} content={`${modeLabels[value]} (Ctrl+${index + 1})`} relationship="description">
                <Tab value={value}>{modeLabels[value]}</Tab>
              </Tooltip>
            ))}
          </TabList>
          {compact && (
            <ChoiceDropdown
              aria-label={strings.displayMode}
              size="small"
              className={styles.dropdown}
              button={{ className: styles.dropdownButton }}
              choices={DISPLAY_MODES}
              value={mode}
              labelOf={(value) => modeLabels[value]}
              onChoose={selectMode}
              // Its list hangs below the top band, so the toolbar stays while the list is open.
              onOpenChange={(_, data) => setModeListOpen(data.open)}
            />
          )}
        </div>
        <div ref={actions} className={styles.actions} onMouseDown={onEmptyToolbarMouseDown}>
          <Tooltip content={strings.pauseClipboardMonitoring} relationship="label">
            <Button
              size="small"
              appearance={paused ? "primary" : "subtle"}
              icon={<PauseRegular />}
              aria-pressed={paused}
              onClick={session.toggleClipboardPause}
            />
          </Tooltip>
          <Tooltip content={strings.regenerate} relationship="label">
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowClockwiseRegular />}
              disabled={!hasInput}
              onClick={session.regenerate}
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
