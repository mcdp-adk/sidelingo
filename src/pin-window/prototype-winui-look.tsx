// PROTOTYPE (Session C, branch prototype/winui-look): throwaway, never merge into main.
// A dev-only switcher for what the look module hasn't settled yet, and a gallery of every Pin window state,
// built from the same Fluent pieces and strings PinWindow uses.
import type { ReactNode } from "react";
import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Text,
} from "@fluentui/react-components";
import { strings } from "../i18n";
import { Markdown } from "../look/Markdown";
import "./prototype-winui-look.css";
import { AXES, cycle, usePrototype, type Axis } from "./prototype-winui-store";

export { usePrototype } from "./prototype-winui-store";

export function PrototypeSwitcher() {
  const prototype = usePrototype();
  if (!import.meta.env.DEV) return null;
  return (
    <div className="proto-switcher" onDoubleClick={(e) => e.stopPropagation()}>
      {(Object.keys(AXES) as Axis[]).map((axis) => (
        <button
          key={axis}
          type="button"
          title={`${axis}: click for next, right-click for previous`}
          onClick={() => cycle(axis, 1)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            cycle(axis, -1);
          }}
        >
          <b>{axis}</b> {AXES[axis][prototype[axis]]}
        </button>
      ))}
    </div>
  );
}

/** A prototype-only caption naming the state below it; deliberately not part of the design. */
function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="proto-state">
      <div className="proto-state-name">{name}</div>
      {children}
    </div>
  );
}

const openSettings = (
  <MessageBarActions>
    <Button size="small">{strings.openSettings}</Button>
  </MessageBarActions>
);

export function StatesGallery({ kind }: { kind: "source" | "translation" }) {
  return (
    <>
      <State name="empty window">
        <Text as="p" block>
          {strings.pinEmptyHint}
        </Text>
      </State>
      <State name="round running, nothing streamed yet">
        <Text as="p" block>
          {kind === "source" ? strings.structuringStatus : strings.translationStatus}
        </Text>
      </State>
      <State name="translation only: muted Source text while structuring">
        <Text as="p" block>
          {strings.structuringStatus}
        </Text>
        <Markdown
          text={"## Muted source\n\nThe Source text shows muted under the status until the translation starts."}
          muted
        />
      </State>
      <State name="no Provider chosen (info)">
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>{strings.chooseProvider}</MessageBarTitle>
          </MessageBarBody>
          {openSettings}
        </MessageBar>
      </State>
      <State name="key cannot be decrypted (error)">
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>{strings.keyUndecryptable}</MessageBarTitle>
          </MessageBarBody>
          {openSettings}
        </MessageBar>
      </State>
      <State name="text over 10,000 characters">
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>{strings.overlongText}</MessageBarTitle>
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small">{strings.processAnyway}</Button>
          </MessageBarActions>
        </MessageBar>
      </State>
      <State name="image without text">
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>{strings.noTextInImage}</MessageBarTitle>
          </MessageBarBody>
        </MessageBar>
      </State>
      <State name="partial text, then a failure that settings can fix">
        <Markdown
          text={"Text that streamed before the failure stays readable above the error; its copy button stays disabled."}
        />
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>{`${strings.translationFailed}: ${strings.providerHttpError} 404`}</MessageBarTitle>
            <Text as="p" block className="proto-error-detail">
              {
                '{"error":{"message":"The model `gpt-luna-latest` does not exist or you do not have access to it.","type":"invalid_request_error"}}'
              }
            </Text>
            <Text as="p" block>
              {strings.imageModelHint}
            </Text>
          </MessageBarBody>
          {openSettings}
        </MessageBar>
      </State>
      <State name="failure with no settings fix">
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>{`${strings.structuringFailed}: ${strings.providerError} 500`}</MessageBarTitle>
            <Text as="p" block className="proto-error-detail">
              upstream connect error or disconnect/reset before headers
            </Text>
          </MessageBarBody>
        </MessageBar>
      </State>
    </>
  );
}
