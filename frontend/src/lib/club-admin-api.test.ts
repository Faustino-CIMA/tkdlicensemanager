import { clearToken, setToken } from "./auth";
import { uploadMemberProfilePicture } from "./club-admin-api";

describe("club-admin profile picture api", () => {
  beforeEach(() => {
    setToken("test-token");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        id: 1,
        has_profile_picture: true,
        profile_picture_original_url: "/media/original.jpg",
        profile_picture_processed_url: "/media/processed.jpg",
        profile_picture_thumbnail_url: "/media/thumb.jpg",
        photo_edit_metadata: {},
        photo_consent_attested_at: null,
        photo_consent_attested_by: null,
        updated_at: "2026-02-11T00:00:00Z",
      }),
      text: async () => "",
    });
  });

  afterEach(() => {
    clearToken();
    jest.resetAllMocks();
  });

  it("sends profile picture upload as FormData", async () => {
    const processedFile = new File(["processed"], "processed.jpg", {
      type: "image/jpeg",
    });
    const originalFile = new File(["original"], "original.heic", {
      type: "image/heic",
    });

    await uploadMemberProfilePicture(12, {
      processedImage: processedFile,
      originalImage: originalFile,
      photoEditMetadata: { source: "jest" },
      photoConsentConfirmed: true,
    });

    const [, fetchOptions] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(fetchOptions.body).toBeInstanceOf(FormData);
    const body = fetchOptions.body as FormData;
    expect(body.get("processed_image")).toBe(processedFile);
    expect(body.get("original_image")).toBe(originalFile);
    expect(body.get("photo_consent_confirmed")).toBe("true");

    const headers = fetchOptions.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Token test-token");
    expect(headers["Content-Type"]).toBeUndefined();
  });
});
