const LOCALE_PREFERENCE_KEY = "zcode-locale-preference";

export function resolveCaptchaLanguage(): "cn" | "en" {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(LOCALE_PREFERENCE_KEY);
    if (stored === "zh-CN") return "cn";
    if (stored === "en-US") return "en";
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
    return "cn";
  }
  return "en";
}
