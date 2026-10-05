import { Dropdown, Option, type DropdownProps } from "@fluentui/react-components";

type ChoiceDropdownProps<T extends string> = Omit<
  DropdownProps,
  "value" | "selectedOptions" | "onOptionSelect" | "children" | "multiselect"
> & {
  /** Every choice, in the order the list shows them. */
  choices: readonly T[];
  /** The current choice, or null for none, which shows the placeholder. */
  value: T | null;
  /** What a choice reads as, closed and in the list. */
  labelOf: (choice: T) => string;
  onChoose: (choice: T) => void;
};

/** A Fluent Dropdown picking one of a fixed set of typed choices, closed on the current one. */
export function ChoiceDropdown<T extends string>({
  choices,
  value,
  labelOf,
  onChoose,
  ...dropdown
}: ChoiceDropdownProps<T>) {
  return (
    <Dropdown
      {...dropdown}
      value={value === null ? "" : labelOf(value)}
      selectedOptions={value === null ? [] : [value]}
      onOptionSelect={(_, data) => {
        const choice = choices.find((c) => c === data.optionValue);
        if (choice !== undefined) onChoose(choice);
      }}
    >
      {choices.map((choice) => (
        <Option key={choice} value={choice}>
          {labelOf(choice)}
        </Option>
      ))}
    </Dropdown>
  );
}
