import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  makeStyles,
  mergeClasses,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  Text,
  Toolbar,
  ToolbarButton,
  Tooltip,
  tokens,
  type PositioningVirtualElement,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { strings } from "./i18n";
import { useShownRound } from "./session";

/** How far the pointer travels before a plain drag moves the window, like Windows' own SM_CXDRAG. */
const DRAG_THRESHOLD = 4;
/** How long the scrollbar stays after the last scroll or pointer movement, in milliseconds. */
const SCROLLBAR_LINGER = 1000;

const hide = () => invoke("hide_pin_window");
const plugins = { cjk };

const useStyles = makeStyles({
  root: { position: "relative", height: "100vh" },
  // Overlays the content with no reserved space, shown while the pointer is over the window.
  toolbar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "flex-end",
    backgroundColor: tokens.colorNeutralBackgroundAlpha,
    backdropFilter: "blur(20px)",
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveEasyEase,
    ":focus-within": { opacity: 1 },
  },
  shown: { opacity: 1 },
  content: {
    boxSizing: "border-box",
    height: "100%",
    overflowY: "auto",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    cursor: "default",
    // A thin, rounded Fluent scrollbar with no arrow buttons, shown only while in use.
    "::-webkit-scrollbar": { width: "6px" },
    "::-webkit-scrollbar-thumb": { borderRadius: tokens.borderRadiusCircular },
  },
  scrollbarShown: { "::-webkit-scrollbar-thumb": { backgroundColor: tokens.colorNeutralForeground3 } },
});

/** A press on the content's own scrollbar, which drags the thumb rather than the window. */
function onScrollbar(e: MouseEvent<HTMLElement>): boolean {
  const content = e.currentTarget;
  return e.target === content && e.clientX - content.getBoundingClientRect().left >= content.clientWidth;
}

export function PinWindow() {
  const styles = useStyles();
  const round = useShownRound();
  const content = useRef<HTMLDivElement>(null);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const [pointerOver, setPointerOver] = useState(false);
  const [scrollbarShown, setScrollbarShown] = useState(false);
  const scrollbarTimer = useRef<number>(undefined);
  const [menu, setMenu] = useState<{ target: PositioningVirtualElement; selection: string } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
    };
    // A hidden window hears no mouseleave, and shows again with neither toolbar nor menu.
    const unlistenHidden = listen("pin-window-hidden", () => {
      setPointerOver(false);
      setMenu(null);
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      clearTimeout(scrollbarTimer.current);
      void unlistenHidden.then((unlisten) => unlisten());
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Each new Round starts at the top; updates within a Round leave the scroll where it is.
  useLayoutEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [round?.id]);

  const showScrollbar = () => {
    setScrollbarShown(true);
    clearTimeout(scrollbarTimer.current);
    scrollbarTimer.current = setTimeout(() => setScrollbarShown(false), SCROLLBAR_LINGER);
  };

  const onDragMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.ctrlKey) return;
    // Without Ctrl a press only moves the window, so it neither selects text nor clears a selection.
    e.preventDefault();
    pressedAt.current = { x: e.screenX, y: e.screenY };
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
    if (!e.ctrlKey && !onScrollbar(e)) void hide();
  };

  return (
    <div
      className={styles.root}
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
      onContextMenu={onContextMenu}
    >
      <div
        ref={content}
        className={mergeClasses(styles.content, scrollbarShown && styles.scrollbarShown)}
        onScroll={showScrollbar}
        onMouseMove={showScrollbar}
        onMouseDown={(e) => {
          if (!onScrollbar(e)) onDragMouseDown(e);
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {round ? (
          <Streamdown plugins={plugins}>{round.state.source.text}</Streamdown>
        ) : (
          <Text as="p" block>
            {strings.pinEmptyHint}
          </Text>
        )}
      </div>
      <Toolbar
        className={mergeClasses(styles.toolbar, pointerOver && styles.shown)}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onDragMouseDown(e);
        }}
      >
        <Tooltip content={strings.close} relationship="label">
          <ToolbarButton appearance="subtle" icon={<DismissRegular />} onClick={() => void hide()} />
        </Tooltip>
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
