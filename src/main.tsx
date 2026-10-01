import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { uiLanguage } from "./i18n";
import { PinWindow } from "./PinWindow";

document.documentElement.lang = uiLanguage;
const dark = matchMedia("(prefers-color-scheme: dark)").matches;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
      <PinWindow />
    </FluentProvider>
  </StrictMode>,
);
