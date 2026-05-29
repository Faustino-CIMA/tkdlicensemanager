import { act, fireEvent, render, screen } from "@testing-library/react";

import { MemberHistoryTimeline } from "./member-history-timeline";

describe("MemberHistoryTimeline", () => {
  const baseProps = {
    licenseTitle: "Licenses",
    gradeTitle: "Grades",
    emptyLabel: "No history entries yet.",
    licenseYearLabel: "Year",
    licenseTypeLabel: "License type",
    licenseStatusLabel: "Status",
    licenseIssuedLabel: "Issued",
    gradeDateLabel: "Date",
    gradeLabel: "Grade",
    gradeIssuedByLabel: "Issued by",
    licenseHistory: [],
    gradeHistory: [],
  };

  it("renders empty states", () => {
    render(<MemberHistoryTimeline {...baseProps} />);
    expect(screen.getAllByText("No history entries yet.").length).toBeGreaterThan(0);
  });

  it("renders history table rows", () => {
    render(
      <MemberHistoryTimeline
        {...baseProps}
        licenseHistory={[
          {
            id: 1,
            member: 1,
            license: 1,
            club: 1,
            order: null,
            payment: null,
            actor: null,
            event_type: "issued",
            event_at: "2026-01-01T00:00:00Z",
            reason: "Created",
            metadata: {},
            license_year: 2026,
            status_before: "",
            status_after: "pending",
            club_name_snapshot: "Club",
            license_type_name: "Athlete",
            created_at: "2026-01-01T00:00:00Z",
          },
        ]}
        gradeHistory={[
          {
            id: 1,
            member: 1,
            club: 1,
            examiner_user: null,
            from_grade: "8th Kup",
            to_grade: "7th Kup",
            promotion_date: "2026-02-01",
            exam_date: null,
            proof_ref: "",
            notes: "Good exam",
            created_by: "Club",
            metadata: {},
            created_at: "2026-02-01T00:00:00Z",
          },
        ]}
      />
    );
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("Athlete")).toBeInTheDocument();
    expect(screen.getByText("7th Kup")).toBeInTheDocument();
    expect(screen.getByText("Club")).toBeInTheDocument();
  });

  it("submits add grade form", async () => {
    const onPromote = jest.fn(async () => {});
    render(
      <MemberHistoryTimeline
        {...baseProps}
        onPromote={onPromote}
        addGradeAriaLabel="Add grade"
        gradeFormTitle="Add grade promotion"
        promoteToGradeLabel="New grade"
        promoteDateLabel="Promotion date"
        issuedByLabel="Issued by"
        issuedByClubOption="Club"
        issuedByLtfOption="LTF"
        issuedByOtherOption="Other"
        issuedByOtherPlaceholder="Enter issuer name"
        promoteSubmitLabel="Save promotion"
        cancelLabel="Cancel"
      />
    );

    fireEvent.click(screen.getByLabelText("Add grade"));
    fireEvent.click(screen.getByRole("combobox", { name: "New grade" }));
    fireEvent.click(screen.getByRole("option", { name: "1st Dan" }));
    await act(async () => {
      fireEvent.click(screen.getByText("Save promotion"));
    });

    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith(
      expect.objectContaining({ to_grade: "1st Dan", created_by: "Club" })
    );
  });
});
