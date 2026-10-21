import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { cloneElement, forwardRef, useId } from "react";

export type FieldTone = "default" | "warning" | "security" | "error";

export interface FormFieldProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  readonly children: ReactElement<{
    readonly "aria-describedby"?: string;
    readonly "aria-invalid"?: boolean | "false" | "true";
    readonly id?: string;
  }>;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly htmlFor: string;
  readonly information?: ReactNode;
  readonly label: ReactNode;
  readonly required?: boolean;
  readonly tone?: FieldTone;
}

/**
 * Persistent label, help, requirement, and error presentation for native
 * controls. Callers associate the child control through `htmlFor` and `id`.
 */
export function FormField({
  children,
  className,
  description,
  error,
  htmlFor,
  information,
  label,
  required = false,
  tone = "default",
  ...rest
}: FormFieldProps) {
  const componentId = useId();
  const descriptionId = `${componentId}-description`;
  const errorId = `${componentId}-error`;
  const classes = ["cm-form-field", className].filter(Boolean).join(" ");
  const describedBy = [
    children.props["aria-describedby"],
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter(Boolean)
    .join(" ");
  const childProps = {
    ...(children.props.id === undefined ? { id: htmlFor } : {}),
    ...(describedBy.length === 0 ? {} : { "aria-describedby": describedBy }),
    ...(error === undefined || children.props["aria-invalid"] !== undefined
      ? {}
      : { "aria-invalid": true as const }),
  };

  return (
    <div
      {...rest}
      className={classes}
      data-tone={error === undefined ? tone : "error"}
    >
      <div className="cm-form-field__heading">
        <label className="cm-form-field__label" htmlFor={htmlFor}>
          <span>{label}</span>
          {required ? (
            <span className="cm-form-field__required">Required</span>
          ) : null}
        </label>
        {information === undefined ? null : (
          <span className="cm-form-field__information">{information}</span>
        )}
      </div>
      {description === undefined ? null : (
        <div className="cm-form-field__description" id={descriptionId}>
          {description}
        </div>
      )}
      <div className="cm-form-field__control">
        {cloneElement(children, childProps)}
      </div>
      {error === undefined ? null : (
        <div className="cm-form-field__error" id={errorId}>
          {error}
        </div>
      )}
    </div>
  );
}

export type InputProps = ComponentPropsWithoutRef<"input">;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  const classes = ["cm-input", className].filter(Boolean).join(" ");
  return <input {...rest} className={classes} ref={ref} />;
});

export type SearchInputProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

export function SearchInput({ className, ...rest }: SearchInputProps) {
  const classes = ["cm-input", "cm-search-input", className]
    .filter(Boolean)
    .join(" ");

  return <input {...rest} className={classes} type="search" />;
}

export type SelectProps = ComponentPropsWithoutRef<"select">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, ...rest }, ref) {
    const classes = ["cm-select", className].filter(Boolean).join(" ");
    return <select {...rest} className={classes} ref={ref} />;
  },
);

export type TextareaProps = ComponentPropsWithoutRef<"textarea">;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...rest }, ref) {
    const classes = ["cm-input", className].filter(Boolean).join(" ");
    return <textarea {...rest} className={classes} ref={ref} />;
  },
);

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<"input">,
  "children" | "id" | "type"
> {
  readonly description?: ReactNode;
  readonly inputId?: string;
  readonly label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, description, inputId, label, ...rest }, ref) {
    const generatedId = useId();
    const id = inputId ?? generatedId;
    const descriptionId = `${id}-description`;
    const classes = ["cm-choice", className].filter(Boolean).join(" ");

    return (
      <div className={classes}>
        <input
          {...rest}
          aria-describedby={
            description === undefined
              ? rest["aria-describedby"]
              : [rest["aria-describedby"], descriptionId]
                  .filter(Boolean)
                  .join(" ")
          }
          className="cm-choice__control"
          id={id}
          ref={ref}
          type="checkbox"
        />
        <label className="cm-choice__label" htmlFor={id}>
          {label}
        </label>
        {description === undefined ? null : (
          <div className="cm-choice__description" id={descriptionId}>
            {description}
          </div>
        )}
      </div>
    );
  },
);

export interface RadioOption {
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly label: ReactNode;
  readonly value: string;
}

export interface RadioGroupProps extends Omit<
  ComponentPropsWithoutRef<"fieldset">,
  "children" | "onChange"
> {
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly legend: ReactNode;
  readonly name: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly RadioOption[];
  readonly value: string;
}

export function RadioGroup({
  className,
  description,
  disabled,
  error,
  legend,
  name,
  onValueChange,
  options,
  value,
  ...rest
}: RadioGroupProps) {
  const componentId = useId();
  const descriptionId = `${componentId}-description`;
  const errorId = `${componentId}-error`;
  const classes = ["cm-radio-group", className].filter(Boolean).join(" ");
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset
      {...rest}
      aria-describedby={describedBy.length === 0 ? undefined : describedBy}
      className={classes}
      disabled={disabled}
    >
      <legend className="cm-radio-group__legend">{legend}</legend>
      {description === undefined ? null : (
        <div className="cm-radio-group__description" id={descriptionId}>
          {description}
        </div>
      )}
      <div className="cm-radio-group__options">
        {options.map((option, index) => {
          const optionId = `${componentId}-${String(index)}`;
          const optionDescriptionId = `${optionId}-description`;

          return (
            <div className="cm-choice" key={option.value}>
              <input
                aria-describedby={
                  option.description === undefined
                    ? undefined
                    : optionDescriptionId
                }
                checked={option.value === value}
                className="cm-choice__control"
                disabled={option.disabled}
                id={optionId}
                name={name}
                onChange={() => {
                  onValueChange(option.value);
                }}
                type="radio"
                value={option.value}
              />
              <label className="cm-choice__label" htmlFor={optionId}>
                {option.label}
              </label>
              {option.description === undefined ? null : (
                <div
                  className="cm-choice__description"
                  id={optionDescriptionId}
                >
                  {option.description}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error === undefined ? null : (
        <div className="cm-radio-group__error" id={errorId}>
          {error}
        </div>
      )}
    </fieldset>
  );
}
