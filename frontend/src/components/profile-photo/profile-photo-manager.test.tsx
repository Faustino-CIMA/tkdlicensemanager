import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProfilePhotoManager } from "./profile-photo-manager";

jest.mock("react-easy-crop", () => {
  return {
    __esModule: true,
    default: function CropperMock({
      onCropComplete,
    }: {
      onCropComplete: (area: unknown, pixels: unknown) => void;
    }) {
      React.useEffect(() => {
        onCropComplete(null, { x: 0, y: 0, width: 500, height: 700 });
      }, []);
      return <div data-testid="cropper">cropper</div>;
    },
  };
});

class MockImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  set src(_value: string) {
    if (this.onload) {
      this.onload();
    }
  }
}

const labels = {
  sectionTitle: "Profile picture",
  sectionSubtitle: "Upload photo",
  changeButton: "Change photo",
  removeButton: "Remove photo",
  downloadButton: "Download",
  modalTitle: "Update profile picture",
  modalDescription: "Crop and save",
  dragDropLabel: "Drop image",
  selectFileButton: "Choose file",
  cameraButton: "Use camera",
  zoomLabel: "Zoom",
  backgroundColorLabel: "Background color",
  removeBackgroundButton: "Remove background",
  removeBackgroundBusy: "Removing background...",
  consentLabel: "Consent",
  saveButton: "Save photo",
  saveBusy: "Saving photo...",
  cancelButton: "Cancel",
  previewTitle: "Preview",
  currentPhotoAlt: "Preview",
  emptyPhotoLabel: "No photo",
  removeBackgroundUnsupported: "Unsupported",
};

function buildFetchResponse(
  ok: boolean,
  options?: { status?: number; blob?: Blob }
): Response {
  return {
    ok,
    status: options?.status ?? (ok ? 200 : 401),
    blob: async () => options?.blob ?? new Blob(["image"], { type: "image/jpeg" }),
  } as Response;
}

describe("ProfilePhotoManager", () => {
  beforeAll(() => {
    Object.defineProperty(global, "Image", {
      writable: true,
      value: MockImage,
    });
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: jest.fn(() => "blob:mock"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      writable: true,
      value: () => ({
        fillStyle: "",
        fillRect: jest.fn(),
        drawImage: jest.fn(),
      }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      writable: true,
      value: (callback: (blob: Blob) => void) => {
        callback(new Blob(["image"], { type: "image/jpeg" }));
      },
    });
    Object.defineProperty(globalThis, "fetch", {
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis.fetch as jest.Mock).mockReset();
    window.localStorage.clear();
  });

  it("loads stored thumbnail using authenticated request", async () => {
    window.localStorage.setItem("ltf_token", "test-token");
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock.mockResolvedValue(buildFetchResponse(true, { blob: new Blob(["thumb"]) }));

    render(
      <ProfilePhotoManager
        labels={labels}
        readOnly
        thumbnailUrl="/api/members/1/profile-picture/thumbnail/"
        imageUrl="/api/members/1/profile-picture/processed/"
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain("/api/members/1/profile-picture/thumbnail/");
    expect((requestInit as RequestInit)?.headers).toEqual({ Authorization: "Token test-token" });
    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Preview" })).toBeInTheDocument();
    });
    expect(screen.queryByText("No photo")).not.toBeInTheDocument();
  });

  it("falls back to processed image when thumbnail fetch fails", async () => {
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(buildFetchResponse(false, { status: 401 }))
      .mockResolvedValueOnce(buildFetchResponse(true, { blob: new Blob(["processed"]) }));

    render(
      <ProfilePhotoManager
        labels={labels}
        readOnly
        thumbnailUrl="/api/members/2/profile-picture/thumbnail/"
        imageUrl="/api/members/2/profile-picture/processed/"
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/members/2/profile-picture/thumbnail/");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/members/2/profile-picture/processed/");
    expect(screen.getByRole("img", { name: "Preview" })).toBeInTheDocument();
  });

  it("shows placeholder when thumbnail and processed image both fail", async () => {
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(buildFetchResponse(false, { status: 401 }))
      .mockResolvedValueOnce(buildFetchResponse(false, { status: 404 }));

    render(
      <ProfilePhotoManager
        labels={labels}
        readOnly
        thumbnailUrl="/api/members/3/profile-picture/thumbnail/"
        imageUrl="/api/members/3/profile-picture/processed/"
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByRole("img", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByText("No photo")).toBeInTheDocument();
  });

  it("opens modal and submits processed payload", async () => {
    const onSave = jest.fn(async () => {});
    const { container } = render(
      <ProfilePhotoManager labels={labels} onSave={onSave} imageUrl={null} thumbnailUrl={null} />
    );

    fireEvent.click(screen.getByText("Change photo"));
    const fileInputs = container.querySelectorAll("input[type='file']");
    const file = new File(["hello"], "sample.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInputs[0], {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Save photo"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const payload = onSave.mock.calls[0][0] as { photoConsentConfirmed: boolean };
    expect(payload.photoConsentConfirmed).toBe(true);
  });
});
