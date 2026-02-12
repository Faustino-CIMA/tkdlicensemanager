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
