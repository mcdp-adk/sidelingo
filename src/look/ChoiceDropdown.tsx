import { Dropdown, Option, makeStyles, type DropdownProps } from "@fluentui/react-components";

const useStyles = makeStyles({
  // The closed button may be narrower than its label, as in the Pin window's compact toolbar.
  button: { minWidth: 0 },
  // The label shrinks and ends in an ellipsis, so the arrow beside it always shows whole.
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

type ChoiceDropdownProps<T extends string> = Omit<
  DropdownProps,
  "value" | "selectedOptions" | "onOptionSelect" | "children" | "multiselect" | "button"
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
  const styles = useStyles();
  const label = value === null ? "" : labelOf(value);
  return (
    <Dropdown
      {...dropdown}
      value={label}
      button={{
        className: styles.button,
        children: <span className={styles.label}>{label || dropdown.placeholder}</span>,
      }}
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
