export const APP_VERSION = "0.5.0";

export const GITHUB_REPO_URL = "https://github.com/Faustino-CIMA/tkdlicensemanager";
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;

export type AppRelease = {
  version: string;
  date: string;
  titleKey: string;
  itemKeys: string[];
};

/**
 * User-facing history for /about.
 * Dates follow CHANGELOG.md when present, otherwise the GitHub tag created_at date.
 */
export const APP_RELEASES: AppRelease[] = [
  {
    version: "0.5.0",
    date: "2026-08-20",
    titleKey: "release050Title",
    itemKeys: [
      "release050UiConsistency",
      "release050PendingLicenses",
      "release050LicenseAvailability",
      "release050FinanceBooks",
      "release050PrefixRewrite",
      "release050LtfIdDigits",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-08-17",
    titleKey: "release040Title",
    itemKeys: [
      "release040Chrome",
      "release040Members",
      "release040ClubLists",
      "release040Iban",
      "release040Logos",
      "release040Designer",
      "release040ClubFilter",
      "release040Import",
    ],
  },
  {
    version: "0.3.9",
    date: "2026-03-28",
    titleKey: "release039Title",
    itemKeys: ["release039Shell", "release039Members", "release039Import"],
  },
  {
    version: "0.3.6",
    date: "2026-03-14",
    titleKey: "release036Title",
    itemKeys: ["release036Printers", "release036Photos"],
  },
  {
    version: "0.3.5",
    date: "2026-03-11",
    titleKey: "release035Title",
    itemKeys: ["release035Svg", "release035Grade", "release035CardSize"],
  },
  {
    version: "0.3.4",
    date: "2026-03-07",
    titleKey: "release034Title",
    itemKeys: ["release034Placement", "release034Parity"],
  },
  {
    version: "0.3.3",
    date: "2026-03-06",
    titleKey: "release033Title",
    itemKeys: ["release033Geometry", "release033Images", "release033Roles"],
  },
  {
    version: "0.3.2",
    date: "2026-03-05",
    titleKey: "release032Title",
    itemKeys: ["release032Publish", "release032Assets", "release032Print"],
  },
  {
    version: "0.3.1",
    date: "2026-03-04",
    titleKey: "release031Title",
    itemKeys: ["release031Polish"],
  },
  {
    version: "0.3.0",
    date: "2026-03-04",
    titleKey: "release030Title",
    itemKeys: ["release030Designer", "release030Simulation", "release030Printing", "release030ClubPrint"],
  },
  {
    version: "0.2.0",
    date: "2026-02-28",
    titleKey: "release020Title",
    itemKeys: ["release020Designer", "release020Print", "release020Preview"],
  },
  {
    version: "0.1.5",
    date: "2026-02-17",
    titleKey: "release015Title",
    itemKeys: ["release015Eligibility", "release015Workflows", "release015Dates"],
  },
  {
    version: "0.1.4",
    date: "2026-02-12",
    titleKey: "release014Title",
    itemKeys: ["release014MemberEdit"],
  },
  {
    version: "0.1.3",
    date: "2026-02-12",
    titleKey: "release013Title",
    itemKeys: ["release013Photos", "release013Dashboard"],
  },
  {
    version: "0.1.2",
    date: "2026-02-10",
    titleKey: "release012Title",
    itemKeys: ["release012Finance", "release012History"],
  },
  {
    version: "0.1.1",
    date: "2026-02-08",
    titleKey: "release011Title",
    itemKeys: ["release011Types", "release011Import", "release011Finance"],
  },
  {
    version: "0.1.0",
    date: "2026-01-27",
    titleKey: "release010Title",
    itemKeys: ["release010Mvp"],
  },
];
