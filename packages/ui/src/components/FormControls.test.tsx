import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Checkbox, Input, Select, Textarea } from "../index.js";

describe("form control refs", () => {
  it("forwards an Input ref to its native input", () => {
    const ref = createRef<HTMLInputElement>();

    render(<Input aria-label="Project name" ref={ref} />);

    ref.current?.focus();

    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveFocus();
  });

  it("forwards a Select ref to its native select", () => {
    const ref = createRef<HTMLSelectElement>();

    render(
      <Select aria-label="Environment" ref={ref}>
        <option>Development</option>
      </Select>,
    );

    ref.current?.focus();

    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveFocus();
  });

  it("forwards a Checkbox ref to its native checkbox", () => {
    const ref = createRef<HTMLInputElement>();

    render(<Checkbox label="Enable encryption" ref={ref} />);

    ref.current?.focus();

    expect(
      screen.getByRole("checkbox", { name: "Enable encryption" }),
    ).toHaveFocus();
  });

  it("forwards a Textarea ref to its native textbox", () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(<Textarea aria-label="List values" ref={ref} />);

    ref.current?.focus();

    expect(screen.getByRole("textbox", { name: "List values" })).toHaveFocus();
  });
});
