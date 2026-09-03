import { fireEvent, render, screen } from "@testing-library/react";
import { User } from "lucide-react";

import { UnderlineTabs } from "./underline-tabs";

describe("UnderlineTabs", () => {
  const options = [
    { value: "overview" as const, label: "Overview", icon: User },
    { value: "grades" as const, label: "Grades", count: 2 },
  ];

  it("marks the active tab and switches on click", () => {
    const onChange = jest.fn();
    render(
      <UnderlineTabs
        value="overview"
        options={options}
        onChange={onChange}
        ariaLabel="Member sections"
        idPrefix="member-detail"
      />
    );

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Grades 2" }));
    expect(onChange).toHaveBeenCalledWith("grades");
  });

  it("moves selection with arrow keys", () => {
    const onChange = jest.fn();
    render(
      <UnderlineTabs
        value="overview"
        options={options}
        onChange={onChange}
        ariaLabel="Member sections"
        idPrefix="member-detail"
      />
    );

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("grades");
  });
});
