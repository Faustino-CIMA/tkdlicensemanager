import { clearToken, getToken, setToken } from "./auth";

describe("auth token helpers", () => {
  it("stores and clears the token in localStorage", () => {
    clearToken();
    expect(getToken()).toBeNull();

    setToken("test-token");
    expect(getToken()).toBe("test-token");

    clearToken();
    expect(getToken()).toBeNull();
  });
});
