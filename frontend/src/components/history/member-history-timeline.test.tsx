import { act, fireEvent, render, screen } from "@testing-library/react";

import { MemberHistoryTimeline } from "./member-history-timeline";

describe("MemberHistoryTimeline", () => {
  const baseProps = {
    title: "History",
    subtitle: "Timeline",
    licenseTitle: "License history",
    gradeTitle: "Grade history",
    emptyLabel: "No history entries yet.",
    eventLabel: "Event",
    reasonLabel: "Reason",
    notesLabel: "Notes",
    fromLabel: "From",
    toLabel: "To",
    licenseHistory: [],
    gradeHistory: [],
  };

  it("renders empty states", () => {
    render(<MemberHistoryTimeline {...baseProps} />);
    expect(screen.getAllByText("No history entries yet.").length).toBeGreaterThan(0);
  });

  it("renders history entries", () => {
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
            metadata: {},
            created_at: "2026-02-01T00:00:00Z",
          },
        ]}
      />
    );
    expect(screen.getByText("2026 - pending")).toBeInTheDocument();
    expect(screen.getByText(/From:/)).toBeInTheDocument();
  });

  it("submits promotion form", async () => {
    const onPromote = jest.fn(async () => {});
    render(
      <MemberHistoryTimeline
        {...baseProps}
        onPromote={onPromote}
        promoteTitle="Promote grade"
        promoteToGradeLabel="New grade"
        promoteDateLabel="Promotion date"
        promoteExamDateLabel="Exam date"
        promoteProofLabel="Proof"
        promoteNotesLabel="Notes"
        promoteSubmitLabel="Save promotion"
      />
    );

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "1st Dan" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Save promotion"));
    });

    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith(
      expect.objectContaining({ to_grade: "1st Dan" })
    );
  });
});
