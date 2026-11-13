export function RequestSecurityHost() {
  return (
    <div
      id="zcode-aliyun-captcha-container"
      aria-hidden="true"
      className="fixed left-0 top-0 z-[2147483647] h-0 w-0 overflow-visible"
    >
      <div
        id="zcode-aliyun-captcha-element"
        className="absolute left-0 top-0 h-0 w-0 overflow-visible"
      />
      <button
        id="zcode-aliyun-captcha-button"
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="fixed left-1/2 top-1/2 h-px w-px -translate-x-1/2 -translate-y-1/2 border-0 p-0 opacity-0"
      />
    </div>
  );
}
