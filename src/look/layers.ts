import { makeStyles, tokens } from "@fluentui/react-components";

/** The looks a component takes on by class, where no Fluent control draws them (DESIGN.md → Layers). */
export const useLayerStyles = makeStyles({
  /** The toolbar layer: opaque on the window's base colour, with a divider below and no blur. */
  toolbar: {
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  /** A frame in the caution colour along the edge of a positioned element, over its content. */
  pausedFrame: {
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      border: `${tokens.strokeWidthThick} solid ${tokens.colorStatusWarningBorder2}`,
      borderRadius: tokens.borderRadiusXLarge,
      pointerEvents: "none",
    },
  },
});
